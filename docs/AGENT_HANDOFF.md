# Agent Handoff

Status: **M0 COMPLETE — Opus final accepted (2026-06-16).** M0-005/006/007/008 all DONE and Opus-accepted. Final full-system acceptance audit passed on a fresh DB: full chain (customer booking → dashboard read model → payment review → OWNER manual verify → cleaner assignment → cleaner lifecycle ON_THE_WAY/IN_PROGRESS/COMPLETED → read model COMPLETED) verified live over HTTP; 5 payment-safety triggers confirmed firing; 209 vitest + 44 E2E (1 skip) green; lint/typecheck clean; audit 0 HIGH. Next: M1. Deferred post-M0: dashboard socket.io client (polling accepted), LOW cleaner-lifecycle ownership-check reorder, UI/UX polish, prod secrets hardening.

## M0-007 Cleaner Lifecycle Completed (2026-06-16, Sonnet)
- Service: `service-agent/services/cleaner-lifecycle.js` (new).
  - `validateCleanerTransition(currentStatus, targetStatus)` — pure, no DB.
  - `getCleanerAssignedBookings(cleanerId)` — returns only this cleaner's active assignments.
  - `transitionCleanerBookingStatus(bookingId, targetStatus, actor)` — enforces payment VERIFIED, ownership, valid transition, appends `booking_status_history`.
- Lifecycle transitions (actual schema status names):
  - QUOTED | BOOKED | ASSIGNED → ON_THE_WAY (EN_ROUTE in task spec)
  - ON_THE_WAY → IN_PROGRESS (ON_SITE in task spec)
  - IN_PROGRESS → COMPLETED
- API endpoints (2 new routes in `server.js`):
  - `GET /api/cleaner/bookings` — CLEANER (own bookings) or OWNER (via ?cleanerId=).
  - `POST /api/cleaner/bookings/:id/status` — body: `{ status }`. CLEANER ownership enforced. OWNER override. DISPATCHER gets 403 from `requireRole`.
- RBAC: CLEANER can only act on their own assigned booking. OWNER overrides. DISPATCHER cannot transition.
- Payment gate: `payment_status = 'VERIFIED'` required before ON_THE_WAY. Returns 409 `PAYMENT_NOT_VERIFIED` otherwise.
- `booking_status_history` row appended on every transition with `actor_type`, `actor_id`, `reason = 'CLEANER_LIFECYCLE'`.
- screenshotUrl security fix (LOW from Opus M0-006): `public/app.js` now validates `http(s):` scheme before rendering as `<a>` link; invalid URLs render as plain text.
- Vitest: 13 new tests in `tests/cleaner-lifecycle.test.js`. Total: 209 (all pass).
- E2E: lifecycle describe block added in `e2e/cleaner-assignment.spec.js`. 12 lifecycle tests. M0-007 skip removed. Total: 44 pass / 1 skip (pre-existing).
- Run results: 209 vitest (all pass), 44 E2E pass / 1 skip (deterministic × 2 runs), lint 0 errors, typecheck clean, audit 0 HIGH.

## M0-008 Completed (2026-06-16, Sonnet)
- Playwright E2E harness added: `service-agent/playwright.config.js`, `service-agent/e2e/` (booking-api, admin-auth, payment-safety, cleaner-assignment specs).
- 21 E2E tests pass; 1 skipped (M0-007 lifecycle, NOT_STARTED with explicit reason).
- Change-password endpoint gap closed: `requireAuth` now skips the dev bypass when an explicit `Bearer` token is present — M0 users testable on localhost. 6 auth endpoint tests in `e2e/admin-auth.spec.js`.
- Payment safety confirmed at E2E level (no VERIFIED path, no verify endpoint, health DB ok).
- Cleaner assign/release + WRONG_STATUS rejection confirmed.
- Cosmetic: redundant `updateUserPassword` import removed; migration 091 comment mislabel fixed.
- 184 vitest + 21 playwright (0 failures). Lint 0 errors. Typecheck clean. Audit 0 high/critical.
- **M0-006 NOT_STARTED. M0-007 lifecycle NOT_STARTED. M0 not complete.**

## Current Controller Notes

- Required `docs/rebuild/*.md` roadmap files are present.
- Control docs were created during this audit: `docs/IMPLEMENTATION_QUEUE.md`, `docs/AGENT_HANDOFF.md`, `docs/M0_STATUS.md`, `docs/design/M0_UI_DESIGN_NOTES.md`.
- Current repo has legacy real SQLite persistence, not the planned normalized M0 schema.
- Service baseline is blocked by a locked/missing `better-sqlite3` install after `npm ci` failed with EPERM on the native module.
- The lock was resolved by stopping the project-like `node server.js` process. MCP/Open Design/Xcode Node processes were left alone.
- Recommended next PRs: Claude Code M0-005a (backend read model + slot-overlap refinement, in progress), MiniMax M0-005b (dashboard SPA swap, on standby, no work yet), Claude Code M0-006 (payment review queue, owner-only verify), Claude Code M0-007 (cleaner assignment).
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
- M0-004C-A: live submit path now calls `window.renderBookingState(form, result, { copy: window.BOOKING_I18N, whatsappUrl: result.whatsappUrl || WHATSAPP_FALLBACK_URL })` when MiniMax's renderer is present. The M0-004A switch is extracted into `renderInlineStatus(form, result)` and kept as a fallback so the form keeps working in dev/test contexts that don't load the result module. The renderer call is wrapped in `try/catch`; on throw, log + fall through to the inline renderer (no fake success, never silent). Success modal opens only on `result.state === 'quoted'`, and the modal's InstaPay block is gated on `result.data?.paymentInstructions` (backend truth) — no longer on `values.payment === 'InstaPay'`. `form.reset()` runs only on `quoted`. Loading state, `disabled` submit button, `aria-busy`, and idempotency behavior are preserved.
- M0-004C-B: MiniMax shipped the runtime i18n bridge (`vite-plugins/i18n.js` injects `window.BOOKING_I18N` with `{lang, dir, bookingStates}`; `booking-result.js` resolves copy from `options.copy || window.BOOKING_I18N`). AR/DE/EN result states localized. `booking-result.js` prefers backend `paymentInstructions.receivingNumber`, falls back to `APP_CONFIG.instapayMobile`. Never says VERIFIED.
- M0-004C-Final: Hermes fixed the last blocker (`46a9a67 fix: correct booking payment instruction copy lookup`). Bug: `pickCopy(copy, 'paymentInstructions')` returned the whole `bookingStates` object, causing `ipCopy.title`/`instructions` to be `undefined`. Fixed with two lines:
  ```js
  const states = pickCopy(copy);
  const ipCopy = states && states.paymentInstructions;
  ```
  AR/DE/EN `paymentInstructions.title` / `instructions` now render correctly. `values.payment` gate fully removed (0 hits). All build/audit gates green. **M0-004 COMPLETE & MERGED** (Opus 4.8 PASS_READY_TO_MERGE_M0_004).

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

## M0-005a Activated (2026-06-16, Hermes PM)

- **Status:** M0-005a is IN PROGRESS. Owned by Hermes Coding (Claude Code) under the M0-005 plan.
- **M0-005b and M0-005c are NOT started.** MiniMax is on standby for M0-005b; Hermes PM owns M0-005c.
- **Scope of M0-005a (this PR):**
  - `service-agent/services/admin-bookings-read.js` (new) — read-only query layer.
  - `service-agent/services/slot-overlap.js` (new) — window-overlap query + malformed-date guard. Replaces M0-003b's `checkSlotConflict` in `public-bookings.js` (same return shape, no caller-visible change).
  - `service-agent/routes/admin.js` — 4 new endpoints: `GET /api/admin/bookings-v2`, `GET /api/admin/bookings-v2/:id`, `GET /api/admin/calendar-v2`, `POST /api/admin/bookings-v2/:id/reschedule`.
  - `service-agent/server.js` — mount the new routes; do NOT touch legacy routes.
  - `service-agent/database.js` — add prepared-statement helpers only. **No schema changes.**
  - 3 new test files: `admin-bookings-read.test.js` (7 tests), `slot-overlap.test.js` (6 tests), extend `public-bookings-m0.test.js` with 1 overlap test. Total 140 → 153.
- **M0-005a does NOT touch:**
  - The M0-001 schema, migrations, or the 5 payment-safety triggers.
  - The landing page (`landing-page/**`).
  - The dashboard (`service-agent/public/app.js`, `service-agent/public/index.html`, `service-agent/public/cleaner.*`).
  - The AI orchestrator or the chat/email integrations.
  - Legacy `/api/bookings`, `/api/calendar`, `/api/bookings/:id/approve`, `/api/bookings/:id/reject` (M0-005b deprecation).
- **Verification on completion:**
  - `service-agent npm test` → 153 passed.
  - Lint clean, typecheck clean.
  - Legacy routes still work (additive, not a swap).
  - Live exercise on a temp DB confirms: list/detail/calendar shape, reschedule rejects past + conflict + malformed, RBAC blocks CLEANER JWT.
- **Full plan:** `docs/M0_REVIEW_PLAN_000_005.md` §11 has the paste-ready prompt.

### Recommended next PRs (in order)
1. **M0-005a (in progress, Hermes Coding):** backend read model + slot-overlap refinement.
2. **M0-005b (after M0-005a, MiniMax, on standby):** dashboard SPA swap + i18n + QA checklist.
3. **M0-005c (after M0-005b, Hermes PM):** docs + legacy-route deprecation prep.
4. **M0-002c (Claude Code, parallel with 2–3):** resolve the pre-existing `service-agent` audit gate failure.
5. **M0-006 (Claude Code):** payment review queue.
6. **M0-007 (Claude Code + MiniMax):** cleaner assignment + status flow.
7. **M0-008 (QA + MiniMax):** Playwright E2E in EN/AR/DE.

### Date sanity check
- All M0-004C and M0-005 dates in this file and `M0_STATUS.md` are **June 16, 2026** (not January 2026). Verified by full-text search. No corrections needed.

---

## M0-006 Completed: Manual InstaPay Payment Review (2026-06-16, Sonnet)

**Commit:** `feat: add manual payment review workflow`

**What was built:**
- `service-agent/services/payments-review.js` — full service layer (list, submit, verify, reject, detail).
- 5 admin API endpoints at `/api/admin/payments` — OWNER + DISPATCHER read/submit; OWNER-only verify/reject.
- Dashboard UI section "Payment Review" in `public/app.js` + `public/index.html`.
- 12 Vitest tests in `tests/payments-review.test.js` (196 total, all green).
- Playwright E2E in `e2e/payment-review.spec.js` (31 pass / 2 skip on 2 consecutive runs).
- `e2e/payment-safety.spec.js` updated to reflect M0-006 endpoint is live.

**RBAC:**
- OWNER: list, detail, submit, verify, reject.
- DISPATCHER: list, detail, submit only. Cannot verify or reject (403).
- CLEANER: 403 on all payment endpoints.
- AI: blocked at service layer AND DB trigger.
- Public: 404 on all admin payment paths.

**Payment safety triggers:** all 5 intact and tested.

**Remaining M0 work:**
- M0-007 cleaner status lifecycle (EN_ROUTE → ON_SITE → COMPLETED) — NOT_STARTED.
- Dashboard socket.io client — NOT_STARTED (server emits, no client subscriber).
- M0 is NOT complete until M0-007 lifecycle is done and Opus accepts.
