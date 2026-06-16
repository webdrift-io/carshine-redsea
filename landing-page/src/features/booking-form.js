// ============================================================================
// CarShine Red Sea - Booking Form Module
// ----------------------------------------------------------------------------
// M0-004A: Real API wiring to POST /api/public/bookings.
// M0-004C-A: Delegate rendering to MiniMax's `window.renderBookingState`
//            (booking-result.js) when it is registered. The inline renderer
//            is kept as a fallback so the form keeps working in dev/test
//            contexts that don't load the result module.
// - No fake success fallback.
// - No hardcoded API URL (VITE_API_BASE_URL with documented localhost fallback).
// - Explicit UI states: idle / loading / quoted / collecting_info /
//   needs_human / duplicate / backend_error / network_error.
// - Submit button disabled while loading.
// - Per-attempt idempotency key.
// - Form only resets on real QUOTED success.
// - Success modal opens only on real QUOTED success.
// - InstaPay instructions in the modal are gated on
//   `result.data.paymentInstructions` (backend truth), NOT on the user's
//   selected payment method.
// ============================================================================

import { showSuccessModal } from '../ui/modals.js';
import {
  buildBookingPayload,
  generateIdempotencyKey,
  submitPublicBooking
} from './booking-api.js';
import { WHATSAPP_FALLBACK_URL } from './config.js';

const SELECTORS = {
  form: '#bookingForm',
  submitBtn: '#bookingForm button[type="submit"]',
  statusRegion: '#bookingFormStatus',
  locationBtn: '.btn-location'
};

const SUBMIT_LABEL_DEFAULT =
  'Confirm My Booking <svg class="mini-inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4Z"/></svg>';
const SUBMIT_LABEL_LOADING = 'Submitting booking…';

/**
 * @returns {{ getValue: (name: string) => string }}
 */
function makeFormReader(form) {
  return {
    getValue: (name) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) return '';
      return (el.value || '').trim();
    }
  };
}

// ---------------------------------------------------------------------------
// Inline fallback renderer
// ---------------------------------------------------------------------------
// Used only when `window.renderBookingState` is missing (e.g. unit tests,
// pre-renderer dev mode, or a regression that drops the result module).
// All tones must stay aligned with the CSS rules for #bookingFormStatus.
//
// M0-004C-A: the live path prefers `window.renderBookingState`; this helper
// is preserved purely as a safety net so the form never silently breaks.
// ---------------------------------------------------------------------------

/**
 * Render the discriminated SubmitResult into the inline status region
 * without using MiniMax's renderer.
 *
 * @param {HTMLFormElement} form
 * @param {object} result   A SubmitResult from booking-api.js.
 */
function renderInlineStatus(form, result) {
  const region = form.querySelector(SELECTORS.statusRegion);
  if (!region) return;
  const state = (result && result.state) || 'idle';
  const tone = INLINE_TONE[state] || 'idle';
  region.dataset.tone = tone;
  region.textContent = '';
  if (state === 'idle') {
    region.hidden = true;
    return;
  }
  const { message, detail } = buildInlineCopy(result);
  const main = document.createElement('div');
  main.className = 'booking-status-main';
  main.textContent = message;
  region.appendChild(main);
  if (detail) {
    const detailEl = document.createElement('div');
    detailEl.className = 'booking-status-detail';
    detailEl.textContent = detail;
    region.appendChild(detailEl);
  }
  region.hidden = false;
}

const INLINE_TONE = {
  loading: 'info',
  quoted: 'success',
  collecting_info: 'warning',
  needs_human: 'warning',
  duplicate: 'info',
  backend_error: 'error',
  network_error: 'error'
};

/**
 * Build the inline message + detail pair for a given result.
 * Extracted so it can be unit-tested without touching the DOM.
 *
 * @param {object} result
 * @returns {{ message: string, detail: string }}
 */
function buildInlineCopy(result) {
  const state = (result && result.state) || 'idle';
  const data = (result && result.data) || {};
  const wa = (result && result.whatsappUrl) || WHATSAPP_FALLBACK_URL;
  const ref = (result && result.bookingRef) || (data && data.id) || '';
  const message = (result && result.message) || '';

  switch (state) {
    case 'loading':
      return { message: 'Sending your booking request…', detail: '' };
    case 'quoted':
      return {
        message: `Booking accepted. Reference: ${ref || '(pending)'}.`,
        detail: 'Please complete payment to confirm. Our team will also reach out on WhatsApp.'
      };
    case 'collecting_info': {
      const missingFields = (data.missingFields || []).slice();
      return {
        message,
        detail: missingFields.length
          ? `We still need: ${missingFields.join(', ')}.`
          : 'Please reply to our WhatsApp follow-up with the missing details.'
      };
    }
    case 'needs_human':
      return { message, detail: `We saved your request. A human will reach out on WhatsApp: ${wa}` };
    case 'duplicate':
      return {
        message,
        detail: ref ? `Existing reference: ${ref}.` : 'No need to resubmit.'
      };
    case 'backend_error':
    case 'network_error':
    default:
      return { message, detail: `Fallback: contact us on WhatsApp — ${wa}` };
  }
}

// ---------------------------------------------------------------------------
// Renderer dispatch (MiniMax's booking-result.js takes priority)
// ---------------------------------------------------------------------------

/**
 * Render a SubmitResult using MiniMax's renderer if available, otherwise
 * fall back to the inline renderer. Never throws.
 *
 * @param {HTMLFormElement} form
 * @param {object} result
 */
function renderResult(form, result) {
  const renderer = (typeof window !== 'undefined' && window.renderBookingState)
    || null;
  const state = (result && result.state) || 'idle';
  if (renderer) {
    try {
      renderer(form, result, {
        copy: (typeof window !== 'undefined' && window.BOOKING_I18N) || undefined,
        whatsappUrl: (result && result.whatsappUrl) || WHATSAPP_FALLBACK_URL
      });
      return;
    } catch (err) {
      // If the renderer throws (e.g. a regression), do NOT fake success.
      // Fall through to the inline renderer so the user still sees the state.
      console.error('[booking-form] renderBookingState threw, falling back:', err);
    }
  }
  renderInlineStatus(form, result);
}

/**
 * Pick the page language from <html lang> so the backend stores it on the
 * booking row. Defaults to 'en'.
 *
 * @returns {'en' | 'ar' | 'de'}
 */
function detectLanguage() {
  const raw = (document.documentElement.getAttribute('lang') || 'en').toLowerCase();
  if (raw.startsWith('ar')) return 'ar';
  if (raw.startsWith('de')) return 'de';
  return 'en';
}

// ---------------------------------------------------------------------------
// Init + submit handler
// ---------------------------------------------------------------------------

export function initBooking() {
  const form = document.querySelector(SELECTORS.form);
  if (!form) return;

  form.addEventListener('submit', handleSubmit);

  // Location button. Defined inline as onclick="getLiveLocation(this)" in
  // the HTML; we do not bind a duplicate listener here.
  const locationBtn = form.querySelector(SELECTORS.locationBtn);
  if (locationBtn) {
    locationBtn.addEventListener('click', () => { /* no-op: inline handler */ });
  }
}

/**
 * @param {SubmitEvent} event
 */
async function handleSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  if (!form) return;

  const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
  if (!submitBtn) return;

  // Guard against double-submit while a request is in flight.
  if (submitBtn.disabled) return;

  const reader = makeFormReader(form);
  const values = {
    name: reader.getValue('name'),
    phone: reader.getValue('phone'),
    email: reader.getValue('email'),
    area: reader.getValue('area'),
    car: reader.getValue('car'),
    package: reader.getValue('package'),
    locationType: reader.getValue('locationType'),
    date: reader.getValue('date'),
    time: reader.getValue('time'),
    condition: reader.getValue('condition'),
    payment: reader.getValue('payment'),
    address: reader.getValue('address'),
    notes: reader.getValue('notes')
  };

  // Minimal client-side required-field guard. Backend re-validates.
  const required = ['name', 'phone', 'area', 'package', 'date', 'time', 'payment'];
  const missing = required.filter((f) => !values[f]);
  if (missing.length > 0) {
    renderResult(form, {
      state: 'collecting_info',
      data: { missingFields: missing },
      message: 'Please fill in all required fields before submitting.',
      detail: `Missing: ${missing.join(', ')}`,
      whatsappUrl: WHATSAPP_FALLBACK_URL
    });
    return;
  }

  const idempotencyKey = generateIdempotencyKey();
  const payload = buildBookingPayload(values, idempotencyKey, detectLanguage());

  // ---- Loading state ----
  submitBtn.disabled = true;
  submitBtn.setAttribute('aria-busy', 'true');
  submitBtn.innerHTML = SUBMIT_LABEL_LOADING;
  renderResult(form, {
    state: 'loading',
    message: 'Sending your booking request…',
    data: null,
    whatsappUrl: WHATSAPP_FALLBACK_URL
  });

  let result;
  try {
    result = await submitPublicBooking(payload);
  } catch (unexpectedErr) {
    // Defensive: submitPublicBooking should never throw, but we still
    // surface a network_error state instead of fake success.
    result = {
      state: 'network_error',
      data: null,
      message: 'Something went wrong while sending your request. Please use WhatsApp to confirm.',
      whatsappUrl: WHATSAPP_FALLBACK_URL
    };
  }

  // Backfill the WhatsApp fallback so downstream renderers don't have to
  // reach into config.js themselves.
  if (!result.whatsappUrl) result.whatsappUrl = WHATSAPP_FALLBACK_URL;

  // ---- Render by state (MiniMax renderer preferred) ----
  renderResult(form, result);

  // ---- Modal: only on real QUOTED success ----
  if (result.state === 'quoted') {
    // InstaPay instructions in the modal are gated on backend truth:
    // paymentInstructions are only attached when the backend actually set up
    // payment (PAYMENT_INSTRUCTIONS_SENT). The user's selected payment method
    // is intentionally NOT used for this gate.
    const paymentInstructions = result.data && result.data.paymentInstructions;
    showSuccessModal(
      'Booking Registered!',
      result.message || 'Thank you. Your booking request has been accepted.',
      'Great, Thanks!',
      paymentInstructions ? 'InstaPay' : ''
    );
    form.reset();
  }

  // ---- Restore submit button ----
  submitBtn.disabled = false;
  submitBtn.removeAttribute('aria-busy');
  submitBtn.innerHTML = SUBMIT_LABEL_DEFAULT;
}
