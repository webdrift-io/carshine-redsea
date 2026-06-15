// ============================================================================
// CarShine Red Sea - Booking Form Module
// ----------------------------------------------------------------------------
// M0-004A: Real API wiring to POST /api/public/bookings.
// - No fake success fallback.
// - No hardcoded API URL (VITE_API_BASE_URL with documented localhost fallback).
// - Explicit UI states: idle / loading / quoted / collecting_info /
//   needs_human / duplicate / backend_error / network_error.
// - Submit button disabled while loading.
// - Per-attempt idempotency key.
// - Form only resets on real success.
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
const SUBMIT_LABEL_DISABLED = 'Please wait…';

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

/**
 * Render an inline status message above the submit button. Replaces the
 * previous behaviour of opening a success modal on every response.
 *
 * @param {HTMLFormElement} form
 * @param {{ tone: 'idle' | 'info' | 'success' | 'warning' | 'error', message: string, detail?: string }} status
 */
function renderStatus(form, status) {
  const region = form.querySelector(SELECTORS.statusRegion);
  if (!region) return;
  region.dataset.tone = status.tone;
  region.textContent = '';
  if (!status.message) {
    region.hidden = true;
    return;
  }
  const main = document.createElement('div');
  main.className = 'booking-status-main';
  main.textContent = status.message;
  region.appendChild(main);
  if (status.detail) {
    const detail = document.createElement('div');
    detail.className = 'booking-status-detail';
    detail.textContent = status.detail;
    region.appendChild(detail);
  }
  region.hidden = false;
}

function clearStatus(form) {
  renderStatus(form, { tone: 'idle', message: '' });
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
    renderStatus(form, {
      tone: 'warning',
      message: 'Please fill in all required fields before submitting.',
      detail: `Missing: ${missing.join(', ')}`
    });
    return;
  }

  const idempotencyKey = generateIdempotencyKey();
  const payload = buildBookingPayload(values, idempotencyKey, detectLanguage());

  // ---- Loading state ----
  submitBtn.disabled = true;
  submitBtn.setAttribute('aria-busy', 'true');
  submitBtn.innerHTML = SUBMIT_LABEL_LOADING;
  renderStatus(form, { tone: 'info', message: 'Sending your booking request…' });

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

  // ---- Render by state ----
  switch (result.state) {
    case 'quoted': {
      renderStatus(form, {
        tone: 'success',
        message: `Booking accepted. Reference: ${result.bookingRef || '(pending)'}.`,
        detail: 'Please complete payment to confirm. Our team will also reach out on WhatsApp.'
      });
      // Keep the existing success modal for the happy path so payment
      // instructions render in a focused surface. Backend may return null
      // payment instructions when InstaPay env is not configured.
      const isInstaPay = values.payment === 'InstaPay';
      showSuccessModal(
        'Booking Registered!',
        result.message || 'Thank you. Your booking request has been accepted.',
        'Great, Thanks!',
        isInstaPay ? 'InstaPay' : ''
      );
      form.reset();
      break;
    }
    case 'collecting_info': {
      const missingFields = (result.data && result.data.missingFields) || [];
      renderStatus(form, {
        tone: 'warning',
        message: result.message,
        detail: missingFields.length
          ? `We still need: ${missingFields.join(', ')}.`
          : 'Please reply to our WhatsApp follow-up with the missing details.'
      });
      break;
    }
    case 'needs_human': {
      const wa = result.whatsappUrl || WHATSAPP_FALLBACK_URL;
      renderStatus(form, {
        tone: 'warning',
        message: result.message,
        detail: `We saved your request. A human will reach out on WhatsApp: ${wa}`
      });
      break;
    }
    case 'duplicate': {
      renderStatus(form, {
        tone: 'info',
        message: result.message,
        detail: result.bookingRef
          ? `Existing reference: ${result.bookingRef}.`
          : 'No need to resubmit.'
      });
      // Do NOT reset the form on duplicate — the user may want to edit.
      break;
    }
    case 'backend_error':
    case 'network_error':
    default: {
      const wa = result.whatsappUrl || WHATSAPP_FALLBACK_URL;
      renderStatus(form, {
        tone: 'error',
        message: result.message,
        detail: `Fallback: contact us on WhatsApp — ${wa}`
      });
      // Do NOT reset the form on failure — preserve user input.
      break;
    }
  }

  // ---- Restore submit button ----
  submitBtn.disabled = false;
  submitBtn.removeAttribute('aria-busy');
  submitBtn.innerHTML = SUBMIT_LABEL_DEFAULT;
}
