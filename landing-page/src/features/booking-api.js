// ============================================================================
// CarShine Red Sea - Public Booking API client
// ----------------------------------------------------------------------------
// Posts to: POST {VITE_API_BASE_URL}/api/public/bookings
//
// Generates an idempotency key per attempt and maps the backend response
// into explicit UI states. Never fabricates a success.
//
// Contract source of truth:
//   service-agent/services/public-bookings.js  (buildCreatedResponse,
//                                              buildDuplicateResponse,
//                                              checkSlotConflict)
//   service-agent/server.js                    (route handler / 500 envelope)
//
// Do NOT change the backend contract from this file. If the backend shape
// changes, update the JSDoc typedefs here and notify the backend owner.
// ============================================================================

import { API_BASE_URL, WHATSAPP_FALLBACK_URL, BOOKING_SOURCE } from './config.js';

/**
 * UI state after a booking submission attempt.
 *
 * @typedef {'idle' | 'loading' | 'quoted' | 'collecting_info'
 *   | 'needs_human' | 'duplicate' | 'backend_error' | 'network_error'
 * } BookingUiState
 */

/**
 * @typedef {Object} PaymentInstructions
 * @property {'INSTAPAY'} method
 * @property {string} receivingNumber
 * @property {string} receivingName
 * @property {number} amount            Amount in minor units (e.g. piasters).
 * @property {string} currency          ISO 4217 currency code.
 * @property {string} bookingRef        Public booking reference.
 * @property {string} message           Localized instructions copy.
 * @property {string} [qrImageUrl]
 * @property {string} [paymentLink]
 */

/**
 * Legacy-compatible booking object returned by the backend.
 * @typedef {Object} LegacyBooking
 * @property {string} id
 * @property {string} bookingV2Id
 * @property {string} status
 * @property {string|null} paymentStatus
 * @property {string|undefined} preferredDate
 * @property {string|undefined} preferredTime
 * @property {string} source
 */

/**
 * Success / duplicate response from POST /api/public/bookings (2xx).
 *
 * @typedef {Object} PublicBookingSuccess
 * @property {true} success
 * @property {string} id                 Public reference (e.g. "CS-20260615-...")
 * @property {string} bookingId          Same as `id` (legacy alias).
 * @property {string} bookingV2Id        Internal UUID.
 * @property {string} customerId
 * @property {string=} vehicleId
 * @property {string=} paymentId
 * @property {'QUOTED' | 'COLLECTING_INFO' | 'NEEDS_HUMAN'} status
 * @property {string|null} paymentStatus
 * @property {string} message
 * @property {PaymentInstructions=} paymentInstructions
 * @property {string[]=} missingFields   Present for COLLECTING_INFO.
 * @property {boolean=} duplicate        True when an existing match was returned.
 * @property {boolean=} idempotent       True when matched by idempotency key.
 * @property {LegacyBooking} booking
 */

/**
 * Controlled failure response from POST /api/public/bookings (2xx with
 * success: false OR non-2xx HTTP). Either shape may carry `missingFields`.
 *
 * @typedef {Object} PublicBookingFailure
 * @property {false} success
 * @property {'COLLECTING_INFO' | 'NEEDS_HUMAN'} [status]
 * @property {string[]} [missingFields]
 * @property {string} [error]           Stable error code, e.g. BOOKING_CREATE_FAILED.
 * @property {string} [message]          Human-readable explanation.
 */

/**
 * Form values collected from the landing booking form. The API client does
 * not validate business rules — it only shapes the payload.
 *
 * @typedef {Object} BookingFormValues
 * @property {string} name
 * @property {string} phone
 * @property {string} [email]
 * @property {string} area
 * @property {string} car
 * @property {string} package
 * @property {string} [locationType]
 * @property {string} [date]            YYYY-MM-DD
 * @property {string} [time]            HH:MM (24h)
 * @property {string} [condition]
 * @property {string} payment
 * @property {string} [address]
 * @property {string} [notes]
 */

/**
 * Discriminated result returned by `submitPublicBooking`.
 *
 * @typedef {Object} SubmitResult
 * @property {BookingUiState} state
 * @property {PublicBookingSuccess | PublicBookingFailure | null} data
 * @property {string} [message]         Localized user-facing message.
 * @property {string} [bookingRef]      Echoed for convenience in UI.
 * @property {string} [whatsappUrl]     Fallback URL when relevant.
 */

/**
 * Generates a per-attempt idempotency key. Stored in `bookings_v2.notes`
 * by the backend. The backend also dedupes the implicit 5-minute window for
 * (phone, scheduledStart, service, WEB_FORM) without a key.
 *
 * @returns {string} uuid v4-ish string (uses crypto.randomUUID when available).
 */
export function generateIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: timestamp + random. Not RFC4122, but unique enough for dedupe.
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Combines `YYYY-MM-DD` and `HH:MM` into a backend-acceptable ISO string.
 * Returns undefined if either part is missing — the backend will treat the
 * request as COLLECTING_INFO with `scheduledStart` in missingFields.
 *
 * @param {string|undefined} date
 * @param {string|undefined} time
 * @returns {string|undefined}
 */
function combineDateTime(date, time) {
  if (!date || !time) return undefined;
  // Local time; backend will reject past timestamps via checkSlotConflict().
  return new Date(`${date}T${time}:00`).toISOString();
}

/**
 * Shape a form payload into the M0 public-booking contract.
 * Maps legacy form field names to canonical API names. Never sends empty
 * strings for non-required fields; the backend treats empty string as
 * "missing" for required fields.
 *
 * @param {BookingFormValues} values
 * @param {string} idempotencyKey
 * @param {string} [language]   BCP-47-ish ('en' | 'ar' | 'de').
 * @returns {Object}
 */
export function buildBookingPayload(values, idempotencyKey, language) {
  const scheduledStart = combineDateTime(values.date, values.time);

  return {
    customerName: values.name,
    phone: values.phone,
    email: values.email || undefined,
    servicePackageCode: values.package,
    serviceType: values.package,
    carType: values.car,
    address: values.address,
    area: values.area,
    preferredDate: values.date,
    preferredTime: values.time,
    scheduledStart,
    notes: values.notes,
    paymentMethod: values.payment,
    source: BOOKING_SOURCE,
    language: language || 'en',
    idempotencyKey
  };
}

/**
 * Submit the booking to the backend and return a discriminated result.
 *
 * IMPORTANT: This function NEVER returns a synthetic success. On any
 * network or non-2xx error it returns a `network_error` or `backend_error`
 * result. UI must surface that honestly.
 *
 * @param {Object} payload  Output of `buildBookingPayload`.
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<SubmitResult>}
 */
export async function submitPublicBooking(payload, options = {}) {
  const fetchImpl = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  if (!fetchImpl) {
    return {
      state: 'network_error',
      data: null,
      message: 'Your browser does not support network requests. Please use the WhatsApp button.',
      whatsappUrl: WHATSAPP_FALLBACK_URL
    };
  }

  const url = `${API_BASE_URL}/api/public/bookings`;

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Idempotency-Key': payload.idempotencyKey
      },
      body: JSON.stringify(payload),
      signal: options.signal
    });
  } catch (networkErr) {
    // DNS failure, offline, CORS preflight blocked, etc.
    return {
      state: 'network_error',
      data: null,
      message: 'We could not reach the booking system. Please use WhatsApp to confirm your booking directly.',
      whatsappUrl: WHATSAPP_FALLBACK_URL
    };
  }

  // Parse body. Backend always returns JSON for this route.
  let body = null;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }

  // HTTP-level failure (the route only emits 500 for BOOKING_CREATE_FAILED
  // and 200/201 for everything else).
  if (response.status >= 500) {
    return {
      state: 'backend_error',
      data: body,
      message: (body && body.message) || 'The booking system is temporarily unavailable. Please try again or use WhatsApp.',
      whatsappUrl: WHATSAPP_FALLBACK_URL
    };
  }

  // Controlled success: 2xx with success: true (QUOTED, COLLECTING_INFO,
  // NEEDS_HUMAN, or duplicate).
  if (response.ok && body && body.success === true) {
    if (body.duplicate === true) {
      return {
        state: 'duplicate',
        data: body,
        bookingRef: body.id || body.bookingId,
        message: body.message || 'We already received your request. Our team will contact you on WhatsApp to confirm.'
      };
    }
    if (body.status === 'QUOTED') {
      return {
        state: 'quoted',
        data: body,
        bookingRef: body.id || body.bookingId,
        message: body.message || 'Booking request accepted. Please complete payment to confirm.'
      };
    }
    if (body.status === 'COLLECTING_INFO') {
      return {
        state: 'collecting_info',
        data: body,
        bookingRef: body.id || body.bookingId,
        message: body.message || 'We saved your request. We still need a few details before we can confirm the booking.'
      };
    }
    if (body.status === 'NEEDS_HUMAN') {
      return {
        state: 'needs_human',
        data: body,
        bookingRef: body.id || body.bookingId,
        message: body.message || 'Your request needs a quick check from our team. We will reach out on WhatsApp shortly.',
        whatsappUrl: WHATSAPP_FALLBACK_URL
      };
    }
    // Unknown success.status — treat as backend error to stay honest.
    return {
      state: 'backend_error',
      data: body,
      message: 'The booking system returned an unexpected response. Please use WhatsApp to confirm.',
      whatsappUrl: WHATSAPP_FALLBACK_URL
    };
  }

  // Controlled failure with 2xx or 4xx (past-time, slot conflict).
  if (body && body.success === false) {
    const state = body.status === 'NEEDS_HUMAN' ? 'needs_human'
      : body.status === 'COLLECTING_INFO' ? 'collecting_info'
      : 'backend_error';
    return {
      state,
      data: body,
      message: body.message || 'The booking could not be accepted as submitted. Please adjust and try again, or use WhatsApp.',
      whatsappUrl: WHATSAPP_FALLBACK_URL
    };
  }

  // Empty body, unexpected shape, or 4xx without success:false.
  return {
    state: 'backend_error',
    data: body,
    message: 'The booking system returned an unexpected response. Please use WhatsApp to confirm.',
    whatsappUrl: WHATSAPP_FALLBACK_URL
  };
}
