# Implementation Queue

Status: M0 readiness audit complete.
Current: M0-004 PASSED & MERGED (Opus 4.8 final re-review PASS). **M0-005a IN PROGRESS** (Hermes Coding / Claude Code: backend read model + slot-overlap refinement). M0-005b on standby.

## M0 Queue

M0-001:
Title: Migration runner and normalized M0 schema foundation
Goal: Move schema ownership out of `service-agent/database.js` into forward-only migrations and add the M0 source-of-truth tables for customers, vehicles, services, bookings v2, payments, payment events, users, assignments, messages, and status history.
Files likely affected: `service-agent/database.js`, `service-agent/migrations/*.js`, `service-agent/tests/migrations.test.js`, `service-agent/tests/fixtures/schema.snapshot.sql`, `service-agent/package.json`
Acceptance criteria: Fresh SQLite DB applies migrations idempotently; FK enforcement is on; old bookings are preserved or migrated; `payments`, `payment_events`, `customers`, `vehicles`, `users`, and `assignments` exist; append-only triggers reject update/delete on event tables; no destructive deletion.
Tests required: Migration test, FK orphan rejection test, append-only trigger test, legacy booking migration test.
Security notes: No secrets in migrations or seed; dev seed gated from production; payment events and booking status history are append-only audit records.
Status: DONE

M0-002:
Title: Fix service dependency baseline, env canonicalization, and audit gate
Goal: Make `service-agent` install and checks reproducible so later PRs have a trustworthy gate.
Files likely affected: `service-agent/package-lock.json`, `service-agent/package.json`, `service-agent/vitest.config.*`, `tsconfig.json` or `service-agent/tsconfig.json`
Acceptance criteria: `npm ci`, `npm run lint`, `npm run typecheck`, and `npm run test` run from `service-agent`; Vitest does not collect tests from `node_modules`; Node version is documented.
Tests required: Baseline command rerun evidence.
Security notes: Do not run `npm audit fix --force` blindly; review dependency changes.
Status: DONE - `npm ci`, lint, typecheck, tests, builds, and high-severity audit gates now run. Root/landing high findings cleared; service has low-only audit findings remaining.

M0-003:
Title: Public booking API v2
Goal: Make `/api/public/bookings` create normalized, idempotent bookings with customer, vehicle, service, payment, and status history records.
Files affected: `service-agent/server.js`, `service-agent/services/public-bookings.js`, `service-agent/tests/public-bookings-m0.test.js`, flow docs.
Acceptance criteria: Valid web booking returns `public_ref`; duplicate idempotency key returns same booking; booking writes normalized M0 tables in one transaction; booking starts with honest non-verified payment status.
Tests required: Integration tests for normalized side effects, missing fields, duplicate key, legacy service mapping, legacy table preservation, conversation/action capture, and payment never verified.
Security notes: Public route remains rate limited; public input cannot create `VERIFIED`; payment events are append-only by existing DB triggers; no secrets added.
Status: DONE - `/api/public/bookings` now writes `customers`, optional `vehicles`, `bookings_v2`, `booking_status_history`, `payments`, `payment_events`, and optional conversation/message/action records. Legacy `bookings` table is preserved and not dual-written.

|M0-004:
|Title: Landing booking form real wiring + renderer integration + i18n bridge
|Goal: Remove fake success and post the landing form to `/api/public/bookings` using configurable API base URL. Integrate MiniMax's result renderer via `window.renderBookingState` with inline fallback. Add runtime i18n bridge (`window.BOOKING_I18N`). Gate InstaPay on backend `paymentInstructions`.
|Files affected: `landing-page/src/features/booking-form.js`, `landing-page/src/features/booking-result.js`, `landing-page/src/features/booking-api.js`, `landing-page/src/features/config.js`, `landing-page/src/features/vite-plugins/i18n.js`, `landing-page/src/i18n/*.json`, `landing-page/index.{en,ar,de}.html`, `landing-page/src/shared/styles.css`, `landing-page/src/main.js`, `docs/M0_004A_QA_CHECKLIST.md`
|Acceptance criteria: Backend-down case shows an error, not success; success displays real `public_ref`; EN/AR/DE behavior covered; no hardcoded `localhost:5000`; InstaPay appears only when backend returns `paymentInstructions`; payment address from backend where available; no fake success; no `VERIFIED` claim; modal opens only on QUOTED; form resets only on QUOTED.
|Tests required: Frontend/unit or Playwright smoke for successful and failed submission; manual QA checklist (12 sections).
|Security notes: Do not expose secrets in Vite env; keep public config only.
|Status: DONE — M0-004C Final Fix merged. `landing-page/src/features/booking-form.js` now posts to `${VITE_API_BASE_URL}/api/public/bookings` with per-attempt `idempotencyKey`. Real submit path calls `window.renderBookingState(form, result, { copy: window.BOOKING_I18N, whatsappUrl: result.whatsappUrl || WHATSAPP_FALLBACK_URL })` when renderer present; inline fallback preserved. `window.BOOKING_I18N` injected by `vite-plugins/i18n.js` with `{lang, dir, bookingStates}`. `booking-result.js` reads `paymentInstructions` from `bookingStates.paymentInstructions`. InstaPay gated on backend `paymentInstructions` (0 `values.payment` hits). AR/DE/EN payment copy localized. All build/audit gates pass (0 vulnerabilities). No service-agent files touched. No new dev-deps. M0-004 COMPLETE.
|
M0-005 (split into M0-005a, M0-005b, M0-005c):
Title: Dashboard calendar reads booking read model
Goal: Replace legacy `bookings` / `calendar_events` reads in the owner dashboard with a real read model over `bookings_v2`, `customers`, `vehicles`, `service_packages`, `payments`, and `bookings_v2.payment_status`. Closes M0-003b N2 (window-overlap slot check) and N3 (malformed-date guard).

M0-005a (IN PROGRESS, Hermes Coding / Claude Code, ~2 days, backend only):
Goal: Build the read-only API surface the dashboard will consume. Refine the slot check to window-overlap. **No schema changes, no frontend changes.**
Files: `service-agent/services/admin-bookings-read.js` (new), `service-agent/services/slot-overlap.js` (new), `service-agent/routes/admin.js` (4 new endpoints), `service-agent/server.js` (mount), `service-agent/database.js` (helpers only, no schema), `service-agent/services/public-bookings.js` (replace `checkSlotConflict` with the new helper; same return shape), `service-agent/tests/admin-bookings-read.test.js` (new, 7 tests), `service-agent/tests/slot-overlap.test.js` (new, 6 tests), `service-agent/tests/public-bookings-m0.test.js` (extend, 1 overlap test).
Acceptance: All 140 existing tests pass; 13 new tests pass (total 140 → 153). 4 new endpoints work: `GET /api/admin/bookings-v2` (filterable, paginated), `GET /api/admin/bookings-v2/:id` (with history), `GET /api/admin/calendar-v2` (narrow projection), `POST /api/admin/bookings-v2/:id/reschedule` (owner-only, calls the new overlap helper, returns 409 on conflict). RBAC: `requireRole(['OWNER','DISPATCHER'])` for reads, `requireRole(['OWNER'])` for reschedule. CLEANER JWT must get 403. Legacy routes still work. Live exercise on a temp DB confirms the shape, the filters, the pagination, and the 3 reschedule failure modes (past, conflict, malformed).
Tests required: 13 new (see above); live exercise output pasted in the PR.
Security notes: All 4 routes are auth-gated; CLEANER is forbidden; reschedule is owner-only. No raw SQL string interpolation. No new dependencies. No schema changes. No payment-trigger changes.

M0-005b (NOT STARTED, MiniMax, ~3 days, frontend only, after M0-005a):
Goal: Dashboard SPA swaps data sources in Today, Bookings, Calendar sections. No fake success. RTL must work. i18n strings in EN/AR/DE. New `docs/M0_005_QA_CHECKLIST.md` with 12 manual sections.
Files: `service-agent/public/app.js` (3 data-source swaps), `service-agent/public/i18n/{en,ar,de}.json` (status badges + empty/loading/error strings), `service-agent/public/index.html` (only if new DOM hooks needed; no layout redesign), `docs/M0_005_QA_CHECKLIST.md` (new).
Acceptance: New bookings appear in dashboard within 2s of landing-form submit (Socket.io). Status badges render in EN/AR/DE. Empty/loading/error states are explicit. Africa/Cairo timezone everywhere. RTL walkthrough in the QA checklist passes.
Tests required: 12-section manual QA checklist, 0–12.
Security notes: No hardcoded data, no fake success, no new UI framework. Shadcn/ui migration is a future refactor, not M0-005b.

M0-005c (NOT STARTED, Hermes PM, after M0-005b):
Goal: Update `docs/rebuild/DASHBOARD_PLAN.md` to reflect the actual M0 status machine (not the aspirational one). Mark legacy routes for deprecation. Flip M0-005 to DONE in the queue.
Files: `docs/rebuild/DASHBOARD_PLAN.md`, `docs/IMPLEMENTATION_QUEUE.md`, `docs/M0_STATUS.md`, `docs/AGENT_HANDOFF.md`.
Acceptance: `DASHBOARD_PLAN.md` matches what the dashboard actually renders; legacy route deprecation ticket exists in the queue.
Tests required: none.
Security notes: none.

Status: M0-005a IN PROGRESS. M0-005b and M0-005c NOT STARTED.

Out of scope for all of M0-005: payment approval UI (M0-006); cleaner assignment UI (M0-007); drag-to-reschedule / drag-to-assign (M0-005b polish at earliest); new Socket.io events (M0-007); shadcn/ui migration (future refactor); multi-tenant (Phase 2); social media / marketing / Postiz / TikTok (Phase 2); real InstaPay API (out of scope, manual only); the landing page; the M0-001 schema, migrations, or the 5 payment-safety triggers.

M0-006:
Title: Owner payment review
Goal: Implement manual InstaPay submission tracking plus owner-only verify/reject.
Files likely affected: `service-agent/routes/admin.js`, `service-agent/routes/public.js`, `service-agent/integrations/instapay.js`, `service-agent/public/app.js`
Acceptance criteria: Customer proof creates `payments.status = PENDING_REVIEW`; owner verify sets `VERIFIED` and booking payment status to `PAID`; reject requires reason; customer messages are queued/logged.
Tests required: Payment submission, verify, reject-without-reason, append-only event, and AI-never-verifies regression.
Security notes: `payment_verify` must be owner-only; receipt access authenticated; file uploads type/size checked.
Status: TODO

M0-007:
Title: Staff assignment and cleaner job status
Goal: Let owner assign a paid booking to a cleaner and let that cleaner move through job statuses.
Files likely affected: `service-agent/routes/admin.js`, `service-agent/routes/cleaner.js`, `service-agent/public/app.js`, `service-agent/public/cleaner.*`
Acceptance criteria: Only paid bookings can be assigned; assignment creates audit history; cleaner sees only own jobs; status transitions emit updates and messages.
Tests required: Owner assignment integration, cleaner own-job authorization, invalid transition, socket event.
Security notes: Enforce RBAC and assignment ownership on every cleaner endpoint.
Status: TODO

M0-008:
Title: Full M0 E2E harness
Goal: Add the runnable E2E-12 scenario and enough supporting tests to prove the milestone.
Files likely affected: `e2e/`, `playwright.config.*`, `service-agent/tests/**`, root and service package scripts
Acceptance criteria: `npm run test:e2e` exists; E2E-12 runs against clean seed data; scenario covers booking, dashboard calendar, payment verify, assignment, cleaner completion, and confirmation message.
Tests required: E2E-12 plus critical API integration tests.
Security notes: E2E must use test credentials and seed data only; no live WhatsApp or payment provider calls.
Status: TODO
