# M0 Status

Status: M0-000 safe baseline complete; M0-001 schema foundation implemented.

M0 target: customer creates booking, booking appears in dashboard calendar,
owner assigns cleaner, payment is tracked and verified, and customer receives
confirmation.

## Current Reality

- Real legacy booking records exist in `service-agent/database.sqlite`.
- Calendar is a separate legacy `calendar_events` table and only gets rows when a booking is approved or manually inserted.
- Payment is still used by the live legacy app as a booking `paymentMethod` string and notes, but M0 schema tables now exist for `payments` and `payment_events`.
- Customers, vehicles, users/cleaners, assignments, service packages, bookings_v2, conversations_v2, messages_v2, and agent_actions now exist as normalized M0 foundation tables.
- Landing page booking form still posts to hardcoded `http://localhost:5000/api/bookings` and has fake success fallback.
- `/api/public/bookings` exists and creates legacy bookings, but it does not implement the planned normalized M0 flow.
- E2E-12 is planned in docs only; no `e2e/` directory or runnable `test:e2e` script exists.

## M0-000 Results

- Safe backup created under ignored `backups/`.
- `service-agent/database.sqlite` was copied to `backups/database-before-m0.sqlite`.
- Project-related `node server.js` process was stopped to unlock `better-sqlite3`.
- Root build script now points to project-local `build-landing.cjs`.
- Hardcoded sample webhook secret was removed from `service-agent/start-server.bat`.
- Safe baseline commit created: `89ae633 chore: establish m0 safe baseline`.

## M0-001 Results

- Migration runner added: `service-agent/migrations/000_migration_runner.js`.
- M0 schema migration added: `service-agent/migrations/010_m0_schema_foundation.js`.
- Dev seed migration added: `service-agent/migrations/090_seed_m0_dev_data.js`.
- `database.js` now runs idempotent migrations after preserving legacy schema.
- Migration tests added: `service-agent/tests/migrations.test.js`.
- New script added: `npm run test:migrations`.
- Live local SQLite has all required M0 tables and legacy tables remain present.

## Verification

- Root `npm ci`: PASS; audit still reports 1 moderate and 1 high vulnerability.
- Root `npm run build`: PASS.
- `landing-page npm ci`: PASS; audit still reports 2 moderate and 1 high vulnerabilities.
- `landing-page npm run build`: PASS with existing large chunk warnings.
- `service-agent npm ci`: PASS; audit reports 2 low vulnerabilities.
- `service-agent npm run test:migrations`: PASS, 5 tests.
- `service-agent npm run test`: PASS, 131 tests.
- `service-agent npm run lint`: PASS with warnings only.
- `service-agent npm run typecheck`: PASS.

## Notes

- Legacy local DB row counts changed during test/import activity, but no destructive migration was performed. The pre-M0 DB copy is preserved in ignored backups.
- M0 tables are foundation-only. Existing routes still write legacy bookings until M0-003/M0-004.

## Next Recommended PR

M0-002 or M0-003: either tighten remaining dependency/test baseline details, or start wiring `/api/public/bookings` to the new normalized schema.
