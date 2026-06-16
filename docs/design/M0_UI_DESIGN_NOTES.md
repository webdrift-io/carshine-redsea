# M0-004B — UI Design Notes

> Status: shipped in the M0-004B commit.
> Owner: MiniMax (Senior Engineer B / UI design builder).
> Reviewer: Opus (Hermes) before merge.

This doc is the handoff for everything visual in M0-004B. It is the source
of truth for the booking-form result states and the dashboard section
structure. If something here conflicts with the code, **the code wins**;
file an update to this doc in the same PR.

---

## 1. Scope reminder

Allowed:
- Booking form layout, field UX, mobile responsiveness.
- Result-state renderer that consumes the discriminated `SubmitResult`
  from `landing-page/src/features/booking-api.js` (Hermes-owned).
- Dashboard visual structure (7 sections, design-only).
- UX copy in EN/AR/DE.
- One isolated `DESIGN_ONLY_MOCKS.js` for the dashboard preview.

Forbidden:
- Schema, migrations, payment triggers, backend code.
- The Hermes-owned API/state logic in `booking-api.js`,
  `booking-form.js`, `config.js`. The status region `#bookingFormStatus`
  was added by M0-004A — we extend it, we do not replace it.
- The shipping dashboard `service-agent/public/index.html` and
  `service-agent/public/app.js` are not touched.
- No fake success. No localhost hardcoding. No "verified" badge in UI.
- No TikTok / Instagram / Facebook / social-marketing additions in M0.

---

## 2. Files added or changed

### Added
- `landing-page/src/features/booking-result.js` — pure-presentation
  renderer. Exposes `renderBookingState(form, submitResult, options)`,
  `clearBookingStatus(form)`, and `initBookingResult()` (mounts the
  renderer and exposes `window.renderBookingState` /
  `window.clearBookingStatus` for any other module to call into).
- `service-agent/public/m0-004b-design/dashboard-preview.html` —
  standalone design-only preview page. Not wired to the live backend.
- `service-agent/public/m0-004b-design/dashboard-preview.css` — visual
  layer for the preview. Dark glassmorphism to match the live dashboard.
- `service-agent/public/m0-004b-design/dashboard-preview.js` — render
  logic for the 7 sections. Reads from `DESIGN_ONLY_MOCKS.js`.
- `service-agent/public/m0-004b-design/DESIGN_ONLY_MOCKS.js` — every
  fake value used by the preview. Heavily commented, single file,
  imports are explicit.
- `docs/design/M0_UI_DESIGN_NOTES.md` — this file.

### Changed
- `landing-page/src/i18n/en.json`,
  `landing-page/src/i18n/ar.json`,
  `landing-page/src/i18n/de.json` — added `bookingStates` (result copy,
  field hints, field labels, location types, conditions, privacy, error
  copy) for all three languages. AR uses Egyptian colloquial.
- `landing-page/src/shared/styles.css` — added result-region sub-element
  styles (icon, missing-fields pills, payment-instructions block,
  primary/secondary CTAs), a `human` tone variant for `needs_human`,
  a `loading` tone variant, and the form layout / field UX styles
  (2-col grid, hint + error, ARIA, mobile responsive). Existing
  classes / rules untouched. M0-004A's `#bookingFormStatus` styles are
  preserved.
- `landing-page/src/main.js` — `initBookingResult()` is now part of
  the boot sequence. Other initializers unchanged.
- `landing-page/index.en.html`,
  `landing-page/index.ar.html`,
  `landing-page/index.de.html` — booking form restructured:
  - Each field wrapped in a `booking-field` container with hint and
    error sub-elements.
  - `aria-describedby` and `aria-required` wired.
  - All visible text now uses `<%= bookingStates.* %>` i18n
    interpolation so the form speaks all three languages.
  - `novalidate` set so Hermes can run her own validation pass.
  - Privacy block below the form makes the
    "AI never verifies payment" promise visible to the customer.
  - Empty `#bookingFormStatus` div (added by M0-004A) preserved.

### Not changed
- `landing-page/src/features/booking-form.js` (Hermes-owned).
- `landing-page/src/features/booking-api.js` (Hermes-owned).
- `landing-page/src/features/config.js` (Hermes-owned).
- `service-agent/public/index.html` (live dashboard).
- `service-agent/public/app.js` (live dashboard logic).
- `service-agent/public/style.css` (live dashboard styles).
- Any backend file, schema, migration, payment trigger, or env example.

---

## 3. Booking result state contract

The renderer mounts sub-elements inside the existing
`#bookingFormStatus` div (which M0-004A added in master). The state
names match the `BookingUiState` typedef in
`landing-page/src/features/booking-api.js`:

| `SubmitResult.state`                                | Tone     | Notes |
|-----------------------------------------------------|----------|-------|
| `'idle'`                                            | `idle`   | Region hidden. |
| `'loading'`                                         | `loading`| Spinner icon. Buttons hidden. |
| `'quoted'`                                          | `success`| Renders InstaPay block when `data.paymentInstructions.method === 'INSTAPAY'`. |
| `'collecting_info'`                                 | `info`   | Renders missing-fields pills when `data.missingFields[]` is non-empty. |
| `'needs_human'`                                     | `human`  | No special sub-blocks. |
| `'duplicate'`                                       | `success`| Same tone as `quoted`; no InstaPay block (the original booking already has one). |
| `'backend_error'`                                   | `error`  | Buttons: WhatsApp (primary) + Try again (secondary, dispatches `booking:retry`). |
| `'network_error'`                                   | `error`  | Same as `backend_error`. |

The renderer is a presentation layer only. It does not call the API
or read from any global state. Hermes' submit handler is the source
of truth for when to call `renderBookingState`.

### WhatsApp fallback

Every terminal state except `'idle'` and `'loading'` shows a "WhatsApp"
button. The link comes from one of:
- `result.whatsappUrl` (Hermes' API client already provides this).
- `WHATSAPP_FALLBACK_URL` from `landing-page/src/features/config.js`.
- The hardcoded `APP_CONFIG.whatsapp` constant (last-resort).

We never prefill a message body — the WhatsApp team can wire that
later through their own path. Per the project rules, we do **not**
hardcode a localhost URL anywhere in this layer.

### "Try again" semantics

For `backend_error` and `network_error`, the secondary CTA dispatches
a `window` `CustomEvent('booking:retry')`. Hermes' submit handler can
listen for it and re-run the submit. The caller can also pass an
`onRetry` option to `renderBookingState` to override the default.

### "Edit my details" semantics

For `collecting_info`, the secondary CTA scrolls the page to the
`#booking` section and focuses the first input. The caller can pass
an `onEdit` option to override.

### Payment-instructions visibility

For `quoted` bookings where `result.data.paymentInstructions.method === 'INSTAPAY'`,
the region shows an InstaPay address block with a click-to-copy
button. The address is `paymentInstructions.receivingNumber` (or
`APP_CONFIG.instapayMobile` as a fallback). It is **not** a hardcoded
secret — it is the public receiving number for the business.

We never mark a payment as VERIFIED in the UI. The only verified
state in the customer flow is "instructions sent" or "we'll review
your receipt and confirm on WhatsApp".

### i18n copy

The renderer pulls copy from the i18n bundle under
`copy.bookingStates[state]`. The required keys are:
- `loading.label` (string)
- `quoted.title` / `quoted.desc` / `quoted.primaryCta` /
  `quoted.primaryAction` / `quoted.secondaryCta` / `quoted.secondaryAction`
- `paymentInstructions.title` / `paymentInstructions.instructions` /
  `paymentInstructions.copyHint` / `paymentInstructions.copied`
- `collecting_info.title` / `collecting_info.desc` /
  `collecting_info.missingLabel` / `collecting_info.primaryCta` /
  `collecting_info.primaryAction` / `collecting_info.secondaryCta` /
  `collecting_info.secondaryAction`
- `needs_human.*` (same shape as `collecting_info`)
- `duplicate.*` (same shape)
- `backend_error.*` (same shape; secondary action = `retry`)
- `network_error.*` (same shape; secondary action = `retry`)

All three language bundles have these keys. The Arabic bundle uses
Egyptian colloquial.

### State-name mapping (for Hermes' submit handler)

Hermes' `booking-api.js` already maps backend shapes to the
`SubmitResult.state` set. The renderer's contract is:
- `idle` and `loading` are transitional (the form looks "in progress").
- `quoted` is success and **only** for `status === 'QUOTED'`.
- `duplicate` is success and **only** for `duplicate === true`.
- `collecting_info` is for incomplete intake (either backend
  `status === 'COLLECTING_INFO'` or controlled failure with same
  status).
- `needs_human` is for human review (backend `status === 'NEEDS_HUMAN'`
  or slot-conflict failure).
- `backend_error` is for HTTP 5xx and unknown response shapes.
- `network_error` is for fetch failures (DNS, offline, CORS).

There is no separate "past-time" or "slot-unavailable" state in the
UI — Hermes' API client already maps past-time to `collecting_info`
and slot-conflict to `needs_human`. The design layer does not need
to know about the underlying reason.

---

## 4. Booking form changes

### Layout

- 2-column grid on tablet+ (>= 720px), single column on mobile.
- Wide fields (textarea, full-width, error, privacy, status region,
  submit) span both columns.
- Submit button is full-width on mobile, auto-width on tablet+.

### Field UX

- Each field is wrapped in a `<div class="booking-field">` with
  optional hint and inline error.
- Hints are subtle (`rgba(255,255,255,0.5)`). Errors turn the field
  red and replace the hint with the error text.
- `aria-describedby` connects the input to its hint and error elements.
- `aria-required="true"` and `aria-invalid` are wired so screen
  readers announce the validation state.
- `<label class="visually-hidden">` keeps the form accessible without
  breaking the visual design.
- iOS auto-zoom is disabled by setting `font-size: 16px` on inputs at
  `max-width: 720px`.

### Submit flow

- The submit button is `<button id="bookingFormSubmit">`. While
  submitting, M0-004A's submit handler sets `disabled` +
  `aria-busy="true"`. The button label swap (`SUBMIT_LABEL_LOADING`)
  is already in M0-004A.
- The form has `novalidate` so the browser doesn't show its own
  popups. Hermes owns the validation logic and the
  `bookingStates.formError.*` copy.

### Privacy block

A short note below the submit button tells the customer that
"Payment is verified manually by our team — we will never mark it
confirmed from this form." This makes the standing decision visible
to the user and pre-empts any "why isn't there a green tick?"
question.

### GPS / live location

The "Use Live Location (GPS)" button is unchanged in behavior — it
still calls `window.getLiveLocation(this)`. It is now styled via CSS
instead of inline styles, and its label is in the i18n bundle.

---

## 5. Dashboard sections (design-only)

The preview at
`/service-agent/public/m0-004b-design/dashboard-preview.html` shows
the 7 sections. None of them are wired to the live backend. To
preview it locally: serve the directory with any static file server
(`python -m http.server` from inside the directory, or open the file
directly in a modern browser — the page uses ES modules so a static
file server is recommended).

### Sections

1. **Today's bookings** — list of bookings for the day, with status
   pills, payment pills, and a missing-fields chip for
   `COLLECTING_INFO`. Filterable by status.
2. **Live inbox** — 4-row summary strip. Full inbox UI is owned by
   the chatbot team; this is just the top-of-dashboard preview.
3. **Calendar / booking board** — day view with hour slots.
   Drag-to-reschedule is the M0-005 work; here we just show the
   visual.
4. **Payment review** — list of payments with
   `RECEIVED_PENDING_REVIEW` status. The "Verify" and "Reject"
   buttons are **not** rendered in the preview because they are
   owner-only and not yet implemented (M0-006).
5. **Cleaner assignment** — grid of cleaner cards. Drag-and-drop is
   the M0-007 work; the visual shows the card structure and the
   "assigned / not assigned" state.
6. **AI autopilot control** — switch + model chain + channel routing
   + last-7-day stats. Disabling autopilot is a non-destructive
   operation; the warning card spells that out.
7. **Human takeover** — list of active threads. "Open thread" is a
   placeholder; full thread view is the M0-005 work.

### Empty / loading / error states

Every section supports the three states out of the box. Reviewers
can flip a section into any state from the browser console:

```js
window.__preview.setState('today', 'error');     // error
window.__preview.setState('inbox', 'empty');     // empty
window.__preview.setState('calendar', 'loading'); // loading
window.__preview.setState('today', 'ready');     // back to data
```

The full list of state keys is in `window.__preview.sections`.

### Status / payment labels

The status pills use the exact enum from `bookings_v2.status` and
`payments.status`. The label table is in
`DESIGN_ONLY_MOCKS.js → STATUS_LABELS` and `PAYMENT_LABELS`. The
shipping dashboard should reuse these tables once it moves off the
legacy `bookings` table.

### Hard rules baked into the preview

- The "AI autopilot" warning says "Disabling autopilot is
  non-destructive. Existing bookings keep their current status."
  This is to make the safety property visible to the owner during
  review.
- The "Payment review" section does **not** render a "Mark verified"
  button. Owners will see the verify/reject UI in M0-006.
- The "Live inbox" and "Human takeover" previews are read-only
  summaries; they do not show message bodies. The chatbot team
  owns that.

---

## 6. i18n coverage

All visible text in the new UI is in `bookingStates` for EN/AR/DE.
The Arabic copy uses Egyptian colloquial where it fits the tone
(booking confirmation: "استلمنا حجزك يا فندم"; collecting-info:
"محتاجين كام تفصيلة كمان"). The German copy is neutral and formal.

The form field placeholders, hint text, error text, location types,
conditions, and the privacy block all localize through the same
`<%= bookingStates.* %>` template. The form HTML is identical in
all three language files — the only thing that changes between
`index.en.html`, `index.ar.html`, and `index.de.html` is the JSON
data the i18n plugin reads.

RTL: the form uses logical properties (no `margin-left` /
`padding-right` on the form itself). The chip layout and pill
layout use `flex` and `gap`, which auto-mirror in RTL. The Arabic
dashboard view will need its own QA pass once the shipping
dashboard is converted to RTL (M0-005 follow-up).

---

## 7. Accessibility

- The result region is `role="status" aria-live="polite"`, so
  screen readers announce state changes without stealing focus.
- The submit button is `aria-busy` while loading.
- The form uses `novalidate` and ARIA attributes for the hints,
  errors, and required state. The visually-hidden labels keep the
  form accessible without breaking the visual design.
- All interactive elements (chips, rows, switches) are keyboard-
  reachable and have visible focus rings.
- The autopilot switch uses a real `<input type="checkbox">` and
  a styled `<span>` slider, so the keyboard works out of the box.
- The warning / privacy blocks use `role="note"` or `aria-label`
  so screen readers announce them.

---

## 8. What Hermes Coding must connect

M0-004A already wired the submit handler to render the
`#bookingFormStatus` region with a small `renderStatus()` helper.
M0-004B is opt-in: Hermes can swap to the richer renderer by
calling `renderBookingState(formElement, submitResult, { copy })`
in place of her current `renderStatus()` call.

The optional `copy` parameter accepts the i18n bundle. If omitted,
the renderer falls back to short English copy (e.g. "Booking
received"). With `copy`, the user sees the localized rich copy.

The renderer is non-destructive — it does not call the API, it
does not block submit, and it does not require any changes to
Hermes' submit handler. The `clearBookingStatus(form)` helper is
exposed for cases where the form is reset and the region should
also be cleared.

This is **Hermes' decision**, not M0-004B's. M0-004B only ships
the richer renderer. The submit handler stays in her ownership.

---

## 9. What Opus should review carefully

1. **State-name contract (§3).** Make sure the `SubmitResult.state`
   set the renderer handles matches what `booking-api.js` actually
   returns. If a state is missing, add it.
2. **Hard-coded WhatsApp number source.** It comes from one of
   `result.whatsappUrl`, `WHATSAPP_FALLBACK_URL` (config.js), or
   `APP_CONFIG.whatsapp` (constants.js). Confirm this is the
   number we want customers to message after a booking. If the
   WhatsApp team is moving to a different number, this is the time
   to flag it.
3. **InstaPay block visibility.** The block only shows for
   `quoted + paymentInstructions.method === 'INSTAPAY'`. If the
   InstaPay config is missing, the backend's payment is
   `UNPAID` and the block will not render. That is intentional —
   we don't want to show a payment UI when there's no actual
   payment method configured.
4. **Privacy block copy.** "Payment is verified manually by our
   team" is a load-bearing promise. The M0-001 DB trigger
   `payments_verified_requires_owner` and the four layers of
   protection in `docs/M0_REVIEW_000_003b.md` §4 already enforce
   this. The UI copy just makes it visible.
5. **Empty/loading/error states.** I included them on every
   section in the dashboard preview. The live dashboard already has
   some of these; M0-005 should align to the same patterns.
6. **The autopilot warning card.** This is a design reminder, not
   a safety mechanism. The actual safety is in the orchestrator
   routing code (M1 work).
7. **The dashboard preview is design-only.** Make sure reviewers
   don't mistake `dashboard-preview.html` for the shipping
   dashboard. The shipping dashboard lives at `/` on the
   `service-agent` server; the preview lives at
   `/m0-004b-design/dashboard-preview.html` and is clearly
   banner-marked.

---

## 10. Commands run (in the worktree)

```bash
# from .worktrees/m0-004b-ui
cd landing-page
npm ci                                  # 0 vulnerabilities
npm run build:all                       # 3 langs, all PASS
npm audit --audit-level=high            # 0 vulnerabilities

cd ..
npm ci                                  # 0 vulnerabilities
npm run build                           # PASS
npm audit --audit-level=high            # 0 vulnerabilities
```

(Full output in the M0-004B UI Report at the end of this PR.)

---

*End of M0-004B design notes.*
