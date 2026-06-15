# Implementation Queue

Status: M0 readiness audit complete. Do not implement until human approval.

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

M0-004:
Title: Landing booking form real wiring
Goal: Remove fake success and post the landing form to `/api/public/bookings` using configurable API base URL.
Files likely affected: `landing-page/src/features/booking-form.js`, `landing-page/src/i18n/*.json`, `landing-page/vite.config.*`
Acceptance criteria: Backend-down case shows an error, not success; success displays real `public_ref`; EN/AR/DE behavior covered; no hardcoded `localhost:5000`.
Tests required: Frontend/unit or Playwright smoke for successful and failed submission.
Security notes: Do not expose secrets in Vite env; keep public config only.
Status: TODO

M0-005:
Title: Dashboard calendar reads booking read model
Goal: Replace legacy `calendar_events` dependency with a calendar read model over real bookings, assignments, and users.
Files likely affected: `service-agent/routes/admin.js`, `service-agent/public/app.js`, `service-agent/database.js`
Acceptance criteria: New booking appears in Today and Calendar without manual calendar insert; assigned cleaner appears when set; no hardcoded agent/list data in M0-critical views.
Tests required: API integration test and dashboard smoke test.
Security notes: Owner/dispatcher auth required for admin calendar APIs.
Status: TODO

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
