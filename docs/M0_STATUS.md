# M0 Status

Status: M0-000 safe baseline complete; M0-001 schema foundation implemented; M0-002b config/audit gate complete; M0-003 public booking API v2 implemented.

M0 target: customer creates booking, booking appears in dashboard calendar,
owner assigns cleaner, payment is tracked and verified, and customer receives
confirmation.

## Current Reality

- Real legacy booking records exist in `service-agent/database.sqlite`.
- Calendar is a separate legacy `calendar_events` table and only gets rows when a booking is approved or manually inserted.
- Payment is still used by the live legacy app as a booking `paymentMethod` string and notes, but M0 schema tables now exist for `payments` and `payment_events`.
- Customers, vehicles, users/cleaners, assignments, service packages, bookings_v2, conversations_v2, messages_v2, and agent_actions now exist as normalized M0 foundation tables.
- Landing page booking form still posts to hardcoded `http://localhost:5000/api/bookings` and has fake success fallback.
- `/api/public/bookings` now creates normalized M0 booking records and preserves a legacy-compatible response object. It does not dual-write to the legacy `bookings` table.
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

- Root `npm ci`: PASS; high audit reports 0 vulnerabilities after Vite upgrade.
- Root `npm run build`: PASS.
- `landing-page npm ci`: PASS; high audit reports 0 vulnerabilities after Vite/plugin-legacy upgrade.
- `landing-page npm run build`: PASS with existing large chunk warnings.
- `service-agent npm ci`: PASS; high audit passes, with 2 low vulnerabilities remaining in `@ai-sdk/provider-utils` via `@mastra/core`.
- `service-agent npm run test:migrations`: PASS, 5 tests.
- `service-agent npm run test`: PASS, 131 tests.
- `service-agent npm run lint`: PASS with warnings only.
- `service-agent npm run typecheck`: PASS.

## Notes

- Legacy local DB row counts changed during test/import activity, but no destructive migration was performed. The pre-M0 DB copy is preserved in ignored backups.
- M0 tables are now used by `/api/public/bookings`. Landing-page wiring is still M0-004.

## Next Recommended PR

M0-004: wire the landing booking form to `/api/public/bookings` and remove fake success fallback.

## M0-002b Results

- Canonical WhatsApp env names are now `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, and `WHATSAPP_APP_SECRET`.
- `META_*` names remain only as commented legacy aliases in env examples.
- `server.js` warns if deprecated aliases are used while canonical variables are missing, without printing secret values.
- CI security audit now installs and runs `npm audit --audit-level=high` for root, `landing-page`, and `service-agent`; high findings fail the workflow.
- Root and landing high-severity `esbuild` advisories were cleared by upgrading Vite and `@vitejs/plugin-legacy`; builds passed after upgrade.
- `docs/rebuild/DATABASE_SCHEMA_PLAN.md` documents `bookings_v2`, `conversations_v2`, and `messages_v2` as intentional non-destructive M0 compatibility names.
- M0-003 is implemented and ready for Hermes review.

## M0-003 Results

- `/api/public/bookings` writes normalized rows in one transaction through `service-agent/services/public-bookings.js`.
- Created records: `customers`, optional `vehicles`, `bookings_v2`, `booking_status_history`, `payments`, `payment_events`, and optional `conversations_v2` / `messages_v2` / `agent_actions` for chatbot-style sources.
- Complete public requests start as `QUOTED`; incomplete requests start as `COLLECTING_INFO`; human-help requests start as `NEEDS_HUMAN`. The public API does not set `BOOKED`.
- A payment row is always created. Initial status is `PAYMENT_INSTRUCTIONS_SENT` when `INSTAPAY_RECEIVING_NUMBER` is configured, otherwise `UNPAID`.
- Public input cannot create `VERIFIED` payments or `VERIFIED` payment events.
- Idempotency behavior: supplied `idempotencyKey` returns the original booking; without a key, duplicate web-form posts for the same customer, service, schedule, and source within five minutes return the existing booking.
- Legacy `serviceType` maps to seeded M0 service packages where possible. Unknown or missing service data uses `M0_INTAKE_PLACEHOLDER` and keeps the booking in `COLLECTING_INFO`.
- Because `bookings_v2.scheduled_start` is required by the locked M0 schema, incomplete requests without a time use an intake placeholder timestamp and expose `scheduledStart` in `missingFields`.
- Legacy `bookings` and `calendar_events` tables are preserved and not written by M0-003.
- New tests: `service-agent/tests/public-bookings-m0.test.js` (6 tests).

---

## Hermes Review of M0-000 + M0-001 (2026-06-15)

### Verdict
**PASS** — M0-003 was unblocked by M0-002b and has now been implemented for review.

### What is locked in
- Live SQLite was backed up to `backups/database-before-m0.sqlite` (gitignored). Reproducible.
- M0 schema tables exist alongside legacy tables. Legacy data is preserved on disk and is not committed. `bookings_v2` and `conversations_v2` are intentionally v2-suffixed; the v2 suffix will be dropped in M1 when the legacy tables are dropped.
- Migrations are idempotent (test: `can run twice without applying duplicate migrations`).
- Legacy tables and rows are preserved by the migration runner (test: `preserves legacy tables and rows`).
- **AI cannot mark a payment VERIFIED** — enforced by the DB trigger `payment_events_no_ai_verify`. The trigger rejects the insert with the message "AI cannot verify payments".
- A `payments.status = 'VERIFIED'` row requires a non-null `verified_by_user_id` — enforced by two DB triggers (`payments_verified_requires_owner` on UPDATE, and `payments_insert_verified_requires_owner` on INSERT).
- `payment_events` is append-only — UPDATE and DELETE both throw "payment_events is append-only".
- All four safety rules are tested in `tests/migrations.test.js → enforces payment audit safety rules`.
- 131 tests pass. 5 new migration tests; the 126 pre-existing tests are untouched.
- CI is wired at `.github/workflows/ci.yml` (lint, format, typecheck, tests, coverage). `npm run test:migrations` is a script.

### Standing decisions reaffirmed
- Preserve legacy tables/data. No destructive migrations in M0.
- AI never verifies payment (DB-enforced now, not just a coding convention).
- No InstaPay API; manual owner verification only.
- Social/marketing stays Phase 2.
- v2 naming (`bookings_v2`, `conversations_v2`) is the M0 convention.

### Open items going into M0-002b
1. M0-002b completed: `.env.example` now uses canonical `WHATSAPP_*` names and `server.js` warns on deprecated aliases.
2. M0-002b completed: high-severity npm audit is now a failing CI gate for root, `landing-page/`, and `service-agent/`.
3. M0-002b completed: `docs/rebuild/DATABASE_SCHEMA_PLAN.md` documents the v2 naming note.

### Owner / next action
- **Codex:** M0-002b and M0-003 are complete. Next implementation is M0-004 after Hermes review.
- **Hermes:** review M0-003, do not expand scope, do not re-litigate M0-001.

### What M0-003 implemented (recap)
- `POST /api/public/bookings` writes to `customers`, optional `vehicles`, `bookings_v2`, `payments`, `payment_events`, and `booking_status_history` in one transaction.
- Idempotency on `(customer_id, scheduled_start, service_package_id, source='WEB_FORM')` within 5 minutes.
- 6 new integration tests; total `service-agent` test count goes from 131 to 137.
- Does not touch the migration runner, the M0 schema, the seed, or the payment-safety triggers.
