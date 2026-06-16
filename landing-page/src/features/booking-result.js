// ============================================================================
// CarShine Red Sea — Booking Result Renderer
// ----------------------------------------------------------------------------
// Pure presentation. Renders the discriminated BookingUiState from
// landing-page/src/features/booking-api.js into the existing
// `#bookingFormStatus` region (added by M0-004A) and (optionally) a
// payment-instructions block.
//
// State names match the BookingUiState typedef in booking-api.js:
//
//   'idle' | 'loading'
//   | 'quoted' | 'collecting_info' | 'needs_human' | 'duplicate'
//   | 'backend_error' | 'network_error'
//
// i18n source: the active language copy is read from
// `window.BOOKING_I18N` (populated by the i18n Vite plugin in
// `vite-plugins/i18n.js`) and falls back to `options.copy` if a caller
// passes one explicitly. When neither is present, the renderer falls
// back to short English copy.
//
// M0-004A submit handler is owned by Hermes Coding. This module is opt-in:
// M0-004A's existing renderStatus() helper does the work today; this module
// provides a richer renderer that Hermes can swap in by calling
// `renderBookingState(formElement, submitResult, { copy })`.
//
// The form has a `#bookingFormStatus[role=status aria-live=polite hidden]`
// div inserted by M0-004A. We extend it with optional sub-regions for
// missing-fields pills, payment-instructions block, and a primary CTA.
//
// We never mark a payment as VERIFIED in the UI. We never show fake
// success. We never hardcode localhost. Payment instructions only render
// when the backend has actually attached a `paymentInstructions` object
// (the same `paymentStatus === 'PAYMENT_INSTRUCTIONS_SENT' -> block` rule
// M0-004A already uses internally). The receiving address comes from
// `paymentInstructions.receivingNumber` (backend-driven) and falls back
// to `APP_CONFIG.instapayMobile` (the public business number) only when
// the backend value is missing. The copy itself is the local i18n copy
// that explicitly tells the customer to send the receipt screenshot on
// WhatsApp for manual review — we never mark the payment as verified
// from the UI.
// ============================================================================

import { APP_CONFIG } from '../shared/constants.js';

const STATE_ICONS = {
  quoted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  collecting_info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M12 16.5v.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  needs_human: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 11V4.5a1.5 1.5 0 0 1 3 0V11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 11V5.5a1.5 1.5 0 0 1 3 0V13" fill="none" stroke="currentColor" stroke-width="2"/><path d="M17 12a1.5 1.5 0 0 1 3 0v5a5 5 0 0 1-5 5h-3a5 5 0 0 1-5-5v-2l-2-3a1.5 1.5 0 0 1 2.5-1.6L8 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  backend_error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2 21h20L12 4Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 11v4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M12 18v.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  network_error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 8.5a16 16 0 0 1 20 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 12.5a11 11 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.5 16.5a6 6 0 0 1 7 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 20v.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><path d="M3 3l18 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  loading: null
};

const STATE_TONES = {
  quoted: 'success',
  collecting_info: 'info',
  needs_human: 'human',
  duplicate: 'success',
  backend_error: 'error',
  network_error: 'error',
  loading: 'loading',
  idle: 'idle'
};

// ---- DOM mount -------------------------------------------------------------

let mounted = false;
let mountedRoot = null;

function ensureMounted(form) {
  if (mounted && mountedRoot === form) return getRegions();
  mountedRoot = form;
  mounted = true;

  let region = form.querySelector('#bookingFormStatus');
  if (!region) {
    region = document.createElement('div');
    region.id = 'bookingFormStatus';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.hidden = true;
    // Insert just above the submit button.
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn && submitBtn.parentNode) {
      submitBtn.parentNode.insertBefore(region, submitBtn);
    } else {
      form.appendChild(region);
    }
  }

  // Sub-regions (idempotent — only created once per form).
  if (!region.querySelector('.booking-result-icon')) {
    const icon = document.createElement('span');
    icon.className = 'booking-result-icon';
    icon.setAttribute('aria-hidden', 'true');
    region.insertBefore(icon, region.firstChild);
  }
  if (!region.querySelector('.booking-status-main')) {
    const main = document.createElement('span');
    main.className = 'booking-status-main';
    region.appendChild(main);
  }
  if (!region.querySelector('.booking-status-detail')) {
    const detail = document.createElement('span');
    detail.className = 'booking-status-detail';
    region.appendChild(detail);
  }
  if (!region.querySelector('.booking-result-pills')) {
    const pills = document.createElement('div');
    pills.className = 'booking-result-pills';
    pills.hidden = true;
    region.appendChild(pills);
  }
  if (!region.querySelector('.booking-result-instapay')) {
    const ip = document.createElement('div');
    ip.className = 'booking-result-instapay';
    ip.hidden = true;
    region.appendChild(ip);
  }
  if (!region.querySelector('.booking-result-actions')) {
    const actions = document.createElement('div');
    actions.className = 'booking-result-actions';
    region.appendChild(actions);
  }

  return getRegions();
}

function getRegions() {
  const region = mountedRoot?.querySelector('#bookingFormStatus');
  if (!region) return null;
  return {
    region,
    icon: region.querySelector('.booking-result-icon'),
    main: region.querySelector('.booking-status-main'),
    detail: region.querySelector('.booking-status-detail'),
    pills: region.querySelector('.booking-result-pills'),
    instapay: region.querySelector('.booking-result-instapay'),
    actions: region.querySelector('.booking-result-actions')
  };
}

// ---- Render ----------------------------------------------------------------

/**
 * Resolve the i18n copy to use. Preference order:
 *   1. options.copy (explicit caller-provided bundle, e.g. tests)
 *   2. window.BOOKING_I18N (runtime bridge from the i18n Vite plugin)
 *   3. null (caller will fall back to English hard-coded copy)
 *
 * The runtime bridge is the supported path for production. The explicit
 * `options.copy` exists so tests and the dashboard preview can override
 * without depending on the bridge being present in the bundle.
 */
function resolveCopy(optionsCopy) {
  if (optionsCopy && optionsCopy.bookingStates) return optionsCopy;
  if (typeof window !== 'undefined' && window.BOOKING_I18N && window.BOOKING_I18N.bookingStates) {
    return window.BOOKING_I18N;
  }
  return null;
}

function pickCopy(copy, state) {
  return (copy && copy.bookingStates) ? copy.bookingStates : null;
}

function getStateCopy(copy, state, fallback) {
  const bundle = pickCopy(copy, state);
  if (!bundle) return null;
  return bundle[state] || null;
}

function applyTone(regions, tone) {
  regions.region.dataset.tone = tone || 'idle';
}

function renderIcon(regions, state) {
  if (!regions.icon) return;
  const svg = STATE_ICONS[state];
  if (svg) {
    regions.icon.innerHTML = svg;
    regions.icon.classList.remove('is-spinner');
  } else if (state === 'loading') {
    regions.icon.innerHTML = '';
    regions.icon.classList.add('is-spinner');
  } else {
    regions.icon.innerHTML = '';
    regions.icon.classList.remove('is-spinner');
  }
}

function renderMessage(regions, main, detail) {
  if (regions.main) {
    if (main) {
      regions.main.textContent = main;
      regions.main.hidden = false;
    } else {
      regions.main.textContent = '';
      regions.main.hidden = true;
    }
  }
  if (regions.detail) {
    if (detail) {
      regions.detail.textContent = detail;
      regions.detail.hidden = false;
    } else {
      regions.detail.textContent = '';
      regions.detail.hidden = true;
    }
  }
}

function renderPills(regions, missingFields, missingLabel) {
  if (!regions.pills) return;
  if (!Array.isArray(missingFields) || missingFields.length === 0) {
    regions.pills.hidden = true;
    regions.pills.innerHTML = '';
    return;
  }
  const labelHtml = missingLabel
    ? `<span class="booking-result-pill-label">${escapeHtml(missingLabel)}</span>`
    : '';
  regions.pills.innerHTML = labelHtml + missingFields
    .map((f) => `<span class="booking-result-pill">${escapeHtml(humanize(f))}</span>`)
    .join('');
  regions.pills.hidden = false;
}

function renderPaymentInstructions(regions, paymentInstructions, copy) {
  if (!regions.instapay) return;
  if (!paymentInstructions || paymentInstructions.method !== 'INSTAPAY') {
    regions.instapay.hidden = true;
    regions.instapay.innerHTML = '';
    return;
  }
  const states = pickCopy(copy);
  const ipCopy = states && states.paymentInstructions;
  if (!ipCopy) {
    regions.instapay.hidden = true;
    return;
  }
  // Backend-driven address. Fall back to the public business number only
  // when the backend did not provide one. We never mark the payment as
  // verified from the UI; the local i18n copy always asks the customer
  // to send the receipt on WhatsApp for manual review.
  const receiving = paymentInstructions.receivingNumber || APP_CONFIG.instapayMobile;
  regions.instapay.innerHTML = `
    <h4>${escapeHtml(ipCopy.title)}</h4>
    <p>${escapeHtml(ipCopy.instructions)}</p>
    <button type="button" class="booking-result-instapay-address" data-copy="${escapeAttr(receiving)}">
      ${escapeHtml(receiving)}
    </button>
    <small>${escapeHtml(ipCopy.copyHint || '')}</small>
  `;
  regions.instapay.hidden = false;
  const btn = regions.instapay.querySelector('.booking-result-instapay-address');
  btn?.addEventListener('click', () => copyToClipboard(btn, ipCopy.copied));
}

function renderActions(regions, state, copy, context) {
  if (!regions.actions) return;
  const stateCopy = getStateCopy(copy, state) || {};
  const primaryLabel = stateCopy.primaryCta;
  const secondaryLabel = stateCopy.secondaryCta;
  const whatsappUrl = context?.whatsappUrl;

  regions.actions.innerHTML = '';

  if (primaryLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'booking-result-btn booking-result-btn-primary';
    btn.textContent = primaryLabel;
    btn.dataset.action = stateCopy.primaryAction || 'whatsapp';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleAction(btn.dataset.action, { whatsappUrl, onRetry: context?.onRetry, onEdit: context?.onEdit });
    });
    regions.actions.appendChild(btn);
  }

  if (secondaryLabel) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'booking-result-btn booking-result-btn-secondary';
    btn.textContent = secondaryLabel;
    btn.dataset.action = stateCopy.secondaryAction || 'close';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      handleAction(btn.dataset.action, { whatsappUrl, onRetry: context?.onRetry, onEdit: context?.onEdit });
    });
    regions.actions.appendChild(btn);
  }
}

function handleAction(action, ctx) {
  if (!action || action === 'close') {
    clearStatus(mountedRoot);
    return;
  }
  if (action === 'whatsapp') {
    if (ctx.whatsappUrl) {
      window.open(ctx.whatsappUrl, '_blank', 'noopener,noreferrer');
    } else {
      window.open(`https://wa.me/${APP_CONFIG.whatsapp}`, '_blank', 'noopener,noreferrer');
    }
    return;
  }
  if (action === 'retry') {
    clearStatus(mountedRoot);
    if (typeof ctx.onRetry === 'function') {
      ctx.onRetry();
    } else {
      window.dispatchEvent(new CustomEvent('booking:retry'));
    }
    return;
  }
  if (action === 'edit') {
    clearStatus(mountedRoot);
    if (typeof ctx.onEdit === 'function') {
      ctx.onEdit();
    } else {
      document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.getElementById('bookingForm')?.querySelector('input,select,textarea')?.focus();
    }
    return;
  }
}

// ---- Public API ------------------------------------------------------------

/**
 * Render a discriminated `SubmitResult` (or any compatible shape) into the
 * form's status region. Returns the state that was rendered.
 *
 * @param {HTMLFormElement} form
 * @param {object} result  A SubmitResult from booking-api.js, or null.
 *   The expected shape:
 *     { state: 'idle' | 'loading' | 'quoted' | 'collecting_info' |
 *             'needs_human' | 'duplicate' | 'backend_error' |
 *             'network_error',
 *       data: any, message: string, bookingRef?: string, whatsappUrl?: string }
 * @param {object} [options]
 *   - copy: the active i18n bundle (with `bookingStates`).
 *   - onRetry?: function invoked when the user clicks the retry CTA.
 *   - onEdit?: function invoked when the user clicks the edit CTA.
 *   - missingFields?: string[] (alternative source for the missing-fields pills)
 *   - paymentInstructions?: object (alternative source for the InstaPay block)
 */
export function renderBookingState(form, result, options = {}) {
  if (!form) return 'idle';
  const regions = ensureMounted(form);
  if (!regions) return 'idle';

  // Resolve the active i18n copy. The runtime bridge (window.BOOKING_I18N)
  // is the production source; options.copy overrides for tests / preview.
  const copy = resolveCopy(options.copy);

  const state = (result && result.state) || 'idle';
  const tone = STATE_TONES[state] || 'idle';

  applyTone(regions, tone);
  renderIcon(regions, state);

  const stateCopy = getStateCopy(copy, state) || {};
  const fallback = (result && result.message) || '';
  let main = '';
  let detail = '';
  if (state === 'idle') {
    main = '';
    detail = '';
  } else if (state === 'loading') {
    main = stateCopy.label || 'Submitting your booking…';
    detail = stateCopy.detail || '';
  } else {
    main = stateCopy.title || fallback;
    detail = stateCopy.desc || (result && result.message) || '';
  }

  renderMessage(regions, main, detail);
  const missing = (options.missingFields
    || (result && result.data && result.data.missingFields)
    || []);
  renderPills(regions, missing, stateCopy.missingLabel);
  renderPaymentInstructions(regions, options.paymentInstructions || (result && result.data && result.data.paymentInstructions), copy);

  if (state === 'idle') {
    regions.region.hidden = true;
  } else {
    regions.region.hidden = false;
  }

  renderActions(regions, state, copy, {
    whatsappUrl: (result && result.whatsappUrl) || options.whatsappUrl,
    onRetry: options.onRetry,
    onEdit: options.onEdit
  });

  return state;
}

/**
 * Clear the status region (e.g. when the form is reset).
 */
export function clearBookingStatus(form) {
  if (!form) return;
  const regions = ensureMounted(form);
  if (!regions) return;
  clearStatus(form);
}

function clearStatus(form) {
  const regions = getRegions();
  if (!regions) return;
  regions.region.hidden = true;
  regions.region.dataset.tone = 'idle';
  if (regions.text) regions.text.innerHTML = '';
  if (regions.pills) {
    regions.pills.hidden = true;
    regions.pills.innerHTML = '';
  }
  if (regions.instapay) {
    regions.instapay.hidden = true;
    regions.instapay.innerHTML = '';
  }
  if (regions.actions) regions.actions.innerHTML = '';
  if (regions.icon) {
    regions.icon.innerHTML = '';
    regions.icon.classList.remove('is-spinner');
  }
}

// ---- Tiny helpers ----------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escapeAttr(s) { return escapeHtml(s); }

function humanize(field) {
  return String(field)
    .replace(/[_-]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function copyToClipboard(btn, copiedMessage) {
  const text = btn.dataset.copy || '';
  if (!text) return;
  const done = () => {
    const original = btn.textContent;
    btn.textContent = copiedMessage || 'Copied';
    btn.classList.add('is-copied');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('is-copied');
    }, 1800);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, done);
  } else {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) { /* noop */ }
    document.body.removeChild(ta);
    done();
  }
}

// ---- Boot ------------------------------------------------------------------

/**
 * Initialise the renderer. Safe to call multiple times.
 * Exposes the renderer on `window` so M0-004A's submit handler (or any
 * other module) can call into it without us editing Hermes-owned code.
 */
export function initBookingResult() {
  const form = document.getElementById('bookingForm');
  if (form) ensureMounted(form);

  window.renderBookingState = renderBookingState;
  window.clearBookingStatus = clearBookingStatus;
}
