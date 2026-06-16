# Agent Handoff

Status: M0-000 complete; M0-001 implemented and verified; M0-002b complete; M0-003 implemented and verified by Hermes; M0-003b implemented; M0-004A landed; M0-004B (UI design layer) implemented; M0-004C-A (renderer integration) landed.

## Current Controller Notes

- Required `docs/rebuild/*.md` roadmap files are present.
- Control docs were created during this audit: `docs/IMPLEMENTATION_QUEUE.md`, `docs/AGENT_HANDOFF.md`, `docs/M0_STATUS.md`, `docs/design/M0_UI_DESIGN_NOTES.md`.
- Current repo has legacy real SQLite persistence, not the planned normalized M0 schema.
- Service baseline is blocked by a locked/missing `better-sqlite3` install after `npm ci` failed with EPERM on the native module.
- The lock was resolved by stopping the project-like `node server.js` process. MCP/Open Design/Xcode Node processes were left alone.
- Recommended next PRs: MiniMax / Claude Code M0-005 (dashboard reads from `bookings_v2`, calendar UI, slot overlap refinement), Claude Code M0-006 (payment review queue, owner-only verify), Claude Code M0-007 (cleaner assignment).
- M0-004A: Hermes Coding shipped landing form real wiring in parallel — the form now posts to the live `/api/public/bookings` endpoint with a discriminated `SubmitResult` (states `idle | loading | quoted | collecting_info | needs_human | duplicate | backend_error | network_error`) and a per-attempt idempotency key. See `docs/M0_004A_QA_CHECKLIST.md` for the 12-section QA checklist.
- M0-004B: shipped alongside M0-004A by MiniMax. UI design layer for the form's result states (rich icon, tone, missing-fields pills, payment-instructions block, primary/secondary CTAs), the form field UX (2-col grid, hint + error per field, ARIA, privacy block, i18n in EN/AR/DE), and a design-only dashboard preview at `service-agent/public/m0-004b-design/`. Composes with M0-004A — `booking-result.js` exposes `window.renderBookingState(form, submitResult, { copy })` and Hermes' submit handler can swap it in for her current `renderStatus()` helper.

## Completed Work

- Phase A commit: `89ae633 chore: establish m0 safe baseline`.
- Root build script fixed.
- Backup created in ignored `backups/`.
- `service-agent/start-server.bat` no longer hardcodes a webhook secret-like value.
- M0 migration runner and schema foundation added.
- Migration tests prove empty DB, rerun idempotency, legacy preservation, dev seed, and payment safety triggers.
- WhatsApp environment naming canonicalized to `WHATSAPP_*`.
- Deprecated WhatsApp `META_*` aliases are supported for one release with warnings and no secret values printed.
- CI high-severity npm audit gate now runs and fails on root, `landing-page`, and `service-agent`.
- Root and landing high audit findings were cleared by upgrading Vite / `@vitejs/plugin-legacy`.
- M0 public booking service added at `service-agent/services/public-bookings.js`.
- `/api/public/bookings` now writes normalized M0 rows in one transaction and returns a legacy-compatible `booking` object.
- Public booking writes `customers`, optional `vehicles`, `bookings_v2`, `booking_status_history`, `payments`, `payment_events`, and optional channel memory rows.
- M0-003 intentionally does not dual-write to legacy `bookings`; legacy tables remain preserved for fallback/read-only compatibility.
- Initial payment state is only `PAYMENT_INSTRUCTIONS_SENT` or `UNPAID`; public booking input cannot set `VERIFIED`.
- Incomplete public intake creates `COLLECTING_INFO` rows with explicit `missingFields`. Schema-required missing service/time values use documented intake placeholders.
- M0-003b: `payments` and `payment_events` rows are only created for `QUOTED` bookings. `COLLECTING_INFO` and `NEEDS_HUMAN` bookings store no payment rows; API returns `paymentStatus: null`.
- M0-003b: slot/past-time precondition: past `scheduledStart` or conflicting active slot blocks `QUOTED` creation and returns a non-success response without writing any booking rows.
- M0-004A: landing form real wiring. `landing-page/src/features/booking-form.js` now posts to `${VITE_API_BASE_URL}/api/public/bookings` with a per-attempt `idempotencyKey`. `landing-page/src/features/config.js` resolves `VITE_API_BASE_URL` / `VITE_WHATSAPP_FALLBACK_URL` / `VITE_BOOKING_SOURCE`; the only `localhost:5000` in the client bundle is the documented local-dev fallback constant. `landing-page/src/features/booking-api.js` returns a discriminated `SubmitResult` with explicit states `idle | loading | quoted | collecting_info | needs_human | duplicate | backend_error | network_error`. Fake success path removed. Submit button is `disabled` + `aria-busy` during the request. Form is reset only on real `QUOTED` success. `landing-page/.env.example` documents the new env vars. Manual QA checklist added at `docs/M0_004A_QA_CHECKLIST.md` (12 sections). EN/AR/DE HTML status region is identical across builds. No service-agent files touched. No new dev-deps. Root + landing `npm audit --audit-level=high` = 0.
- M0-004B: booking form restructured (2-col grid on tablet, single-col on mobile, hint + error on every field, ARIA wired, privacy block). All visible text routes through the i18n bundle in EN/AR/DE. No `booking-form.js` logic touched (Hermes-owned); the new field UX is structural-only.
- M0-004B: new `landing-page/src/features/booking-result.js` renderer composes with M0-004A's `SubmitResult` discriminated union (snake_case states: `loading | quoted | collecting_info | needs_human | duplicate | backend_error | network_error`). Renders into the existing `#bookingFormStatus` region with per-state copy in EN/AR/DE, per-state color tone, an icon, an optional InstaPay address block (for `quoted + paymentInstructions`), and a missing-fields pill list (for `collecting_info`). No localhost, no fake success, no `VERIFIED` in the UI. Exposes `window.renderBookingState(form, submitResult, { copy, onRetry, onEdit })` and `window.clearBookingStatus(form)` for Hermes' submit handler to opt into.
- M0-004B: dashboard design-only preview at `service-agent/public/m0-004b-design/dashboard-preview.html` shows the 7 sections (Today's bookings, Live inbox, Calendar, Payment review, Cleaner assignment, AI autopilot, Human takeover) with empty / loading / error states. All data lives in `DESIGN_ONLY_MOCKS.js` (single file, clearly marked). The shipping dashboard is untouched.
- M0-004B: docs/design/M0_UI_DESIGN_NOTES.md captures the full design contract (state map, file ownership, accessibility, what Hermes must connect, what Opus should review).
- M0-004C-A: live submit path now calls `window.renderBookingState(form, result, { copy: window.BOOKING_I18N, whatsappUrl: result.whatsappUrl || WHATSAPP_FALLBACK_URL })` when MiniMax's renderer is present. The M0-004A switch is extracted into `renderInlineStatus(form, result)` and kept as a fallback so the form keeps working in dev/test contexts that don't load the result module. The renderer call is wrapped in `try/catch`; on throw, log + fall through to the inline renderer (no fake success, never silent). Success modal opens only on `result.state === 'quoted'`, and the modal's InstaPay block is gated on `result.data?.paymentInstructions` (backend truth) — no longer on `values.payment === 'InstaPay'`. `form.reset()` runs only on `quoted`. Loading state, `disabled` submit button, `aria-busy`, and idempotency behavior are preserved.

## Verification Snapshot

- `service-agent npm run test:migrations`: 5 passed.
- `service-agent npm run test`: 140 passed after M0-003b (was 137 after M0-003).
- `service-agent npm run lint`: 0 errors, warnings remain pre-existing/style-level.
- `service-agent npm run typecheck`: passed.
- Root and landing builds passed.
- Root `npm audit --audit-level=high`: passed, 0 vulnerabilities.
- `landing-page npm audit --audit-level=high`: passed, 0 vulnerabilities.
- `service-agent npm audit --audit-level=high`: pre-existing ws/socket.io high findings via `@mastra/core` and `socket.io`; not introduced by M0-003b. Fix requires breaking-change upgrades.

## Claimed Specialist Ownership

- Codex: M0-004 handoff support, M0-006, M0-007 backend/API/database.
- MiniMax/UI agent: M0-004, dashboard UI portions of M0-005/M0-006/M0-007.
- QA agent: M0-002 test baseline and M0-008.
- Security agent: review M0-001 append-only audit, M0-006 payment verify authorization, and M0-007 RBAC.

## M0-003 Verified by Hermes (2026-06-15)

- **Pass.** 137 tests green. M0 schema writes are transactional and safe.
- Live exercise confirmed: happy path, missing fields, idempotency, payment-poison resistance.
- The audit's standing decision "AI must never mark payment VERIFIED" remains enforced at the DB layer and is now also enforced at the API layer.
- Codex M0-003 prompt accepted as-is with four small follow-ups (§11 of the review) that do not block M0-004.
- Full review: `docs/M0_REVIEW_000_003.md`.

## M0-003b Verified by Hermes (2026-06-15)

- **Pass.** 140 tests green. COLLECTING_INFO no longer creates payment rows. Past-time and slot conflicts are rejected without writing booking rows.
- All 5 M0-001 payment-safety triggers are byte-identical and still enforce the standing decision.
- Live exercise confirmed: QUOTED happy, COLLECTING_INFO, past-time, slot conflict, VERIFIED poison, idempotency, row counts. 4 payments for 3 QUOTED bookings (one is the idempotent reuse of the first). Legacy `bookings` table untouched.
- The 6 high-severity `service-agent` audit findings are pre-existing (Mastra → socket.io → engine.io → ws chain) and not introduced by M0-003b. The M0-002b audit gate is currently red for `service-agent`; this is a pre-existing failure tracked under M0-002c.
- Three small next-PR notes (form contract for `success: false`, window-overlap slot check, malformed-date guard) are documented in `docs/M0_REVIEW_000_003b.md` §3.
- Next backend task: M0-005 (dashboard calendar + slot-check refinement). M0-004 (landing form) is owned by MiniMax/frontend.
- **Implementation agent: Claude Code** (Co-Authored-By: Claude Sonnet 4.6 in commit 9f342c9). Codex is on standby.
- Full review: `docs/M0_REVIEW_000_003b.md`.

## M0-004C-B — runtime i18n bridge shipped (2026-06-16)

- **Pass.** Build clean, audit clean, bridge verified, no leak, no secrets, AR/DE localized.
- **What M0-004C-B delivered:** the Vite i18n plugin now injects `<script id="i18n-bridge" type="application/json">{lang, dir, bookingStates}</script>` before `</head>`, plus a tiny inline parser that sets `window.BOOKING_I18N` and dispatches `booking-i18n:ready`. The JSON is escaped against `</script>`, `<!--`, U+2028, U+2029, and only the `bookingStates` subset is exposed (no full bundle, no secrets, no payment credentials). `booking-result.js` gained a `resolveCopy()` helper (`options.copy || window.BOOKING_I18N || null`) used by `renderBookingState()`. `renderPaymentInstructions()` now prefers `paymentInstructions.receivingNumber` and falls back to `APP_CONFIG.instapayMobile` only when missing, and never says VERIFIED.
- **What Hermes must connect:** nothing required. The bridge is auto-injected at build time and auto-read by the renderer. If Hermes wants to override the copy, she can still pass `options.copy` to `renderBookingState()`.
- **What Opus should review:** bridge JSON shape, escape rules, no full bundle leak, no `VERIFIED` in any state, payment-instructions prefer-backend-then-fallback contract.
