# M0 Status

Status: M0-000 safe baseline complete; M0-001 schema foundation implemented; M0-002b config/audit gate complete; M0-003 public booking API v2 implemented; M0-003b payment/slot preconditions implemented; M0-004A landing form real wiring landed.

M0 target: customer creates booking, booking appears in dashboard calendar,
owner assigns cleaner, payment is tracked and verified, and customer receives
confirmation.

## Current Reality

- Real legacy booking records exist in `service-agent/database.sqlite`.
- Calendar is a separate legacy `calendar_events` table and only gets rows when a booking is approved or manually inserted.
- Payment is still used by the live legacy app as a booking `paymentMethod` string and notes, but M0 schema tables now exist for `payments` and `payment_events`.
- Customers, vehicles, users/cleaners, assignments, service packages, bookings_v2, conversations_v2, messages_v2, and agent_actions now exist as normalized M0 foundation tables.
- Landing page booking form (M0-004A landed) now posts to `${VITE_API_BASE_URL}/api/public/bookings` with a per-attempt `idempotencyKey`, explicit UI states, and no fake success fallback. `localhost:5000` exists in the client bundle only as the documented local-dev fallback constant in `landing-page/src/features/config.js`.
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
- M0 tables are now used by `/api/public/bookings`. Landing-page wiring is M0-004A (landed, ready for Hermes review).

## M0-004A Results

- `landing-page/src/features/booking-form.js` rewritten: posts to `${VITE_API_BASE_URL}/api/public/bookings` with a per-attempt `idempotencyKey`; submit button is `disabled` + `aria-busy` while in flight; form is reset only on real `QUOTED` success.
- New `landing-page/src/features/booking-api.js` returns a discriminated `SubmitResult` with explicit states `idle | loading | quoted | collecting_info | needs_human | duplicate | backend_error | network_error`. The `success: false` (past-time / slot conflict) path is now an explicit UI state, not a fake success.
- New `landing-page/src/features/config.js` resolves `VITE_API_BASE_URL` / `VITE_WHATSAPP_FALLBACK_URL` / `VITE_BOOKING_SOURCE` from `import.meta.env` with a documented `http://localhost:5000` local-dev fallback. The only `localhost:5000` in the client bundle is this constant; production builds inject whatever `VITE_API_BASE_URL` is set to.
- All 3 HTML entry points (`index.en.html`, `index.ar.html`, `index.de.html`) received an identical one-line insertion: a `<div id="bookingFormStatus" role="status" aria-live="polite" hidden></div>` between the notes textarea and the submit button. `landing-page/src/shared/styles.css` got a small status-region block with tone colors (info / success / warning / error) and a busy-button cursor.
- `landing-page/.env.example` documents `VITE_API_BASE_URL`, `VITE_WHATSAPP_FALLBACK_URL`, `VITE_BOOKING_SOURCE`.
- `docs/M0_004A_QA_CHECKLIST.md` added: 12 sections covering build/audit gate, env wiring, submit-button disabled state, all 7 UI states, language coverage, idempotency, no-fake-success, security posture.
- `landing-page npm ci` PASS, `npm run build` PASS (3 langs, `feature-booking` chunk = 8.98 kB), `npm audit --audit-level=high` = 0.
- Root `npm ci` PASS, `npm run build` PASS (multilingual build emits `dist/{en,ar,de}/`), `npm audit --audit-level=high` = 0.
- No service-agent files touched. No migrations, schemas, or backend routes changed. No new runtime deps. No dashboard / payment UI / cleaner UI added.
- The inline `getLiveLocation()` button keeps its existing module-based handler from `src/features/location.js` (no regression).

## M0-003b Results

- `COLLECTING_INFO` and `NEEDS_HUMAN` bookings no longer create `payments` or `payment_events` rows.
- `bookings_v2.payment_status` is set to `'UNPAID'` as a schema-required placeholder (column is NOT NULL); no payment object exists.
- API response returns `paymentStatus: null` and `paymentId: undefined` for non-QUOTED bookings to clearly communicate no payment was set up.
- Slot/past-time precondition added: before creating a `QUOTED` booking, `checkSlotConflict()` validates `scheduledStart` is in the future and checks for conflicting `QUOTED`/`CONFIRMED`/`IN_PROGRESS` bookings at the same time.
- Past-time returns `{ success: false, status: 'COLLECTING_INFO', missingFields: ['scheduledStart'] }` without creating any rows.
- Slot conflict returns `{ success: false, status: 'NEEDS_HUMAN' }` without creating any rows.
- 3 new tests; total 140 passing (from 137).
- All existing M0-003 tests continue to pass with no behavior regression for QUOTED bookings.

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

---

## Hermes Review of M0-003 (2026-06-15)

### Verdict
**PASS** — start M0-004 (landing form real wiring). M0-003b is a small follow-up that can ship in parallel with M0-004.

### What M0-003 delivered
- New service `service-agent/services/public-bookings.js` (646 lines). All M0 writes in one transaction.
- `POST /api/public/bookings` is now thin: 14 lines that delegate to the service. Legacy `db.createBooking` is gone from this route.
- Idempotency: explicit key (stored in `bookings_v2.notes`) + implicit `(phone, time, package, source='WEB_FORM')` within 5 min.
- Status machine: `COLLECTING_INFO` for missing fields, `NEEDS_HUMAN` for email/intent, `QUOTED` when complete. Never `BOOKED`.
- Payment safety: initial state is `PAYMENT_INSTRUCTIONS_SENT` or `UNPAID`. Never `VERIFIED`. Verified by a poison test.
- Channel memory: `conversations_v2` + `messages_v2` for CHATBOT, WHATSAPP, EMAIL sources; `agent_actions` for CHATBOT.
- 6 new tests, all real. Total 137 passing. Live DB row counts: 0 in M0 tables, 27 in legacy `bookings` (preserved).

### Open items for the next PRs
1. **M0-003b (Claude Code, parallel with M0-004):** skip `payments` row when `status === 'COLLECTING_INFO'`; add a `slot_check` precondition before `QUOTED`. 3 new tests, total → 140. **Status: done in commit 9f342c9. Verified by Hermes in `docs/M0_REVIEW_000_003b.md`.**
2. **M0-004 (MiniMax, frontend):** wire the landing form to the new payload. No fake success. 201-with-COLLECTING_INFO UI.
3. **M0-005 (MiniMax + Claude Code):** dashboard reads from `bookings_v2` instead of `bookings`. Calendar uses real booking data.
4. **M0-006 (Claude Code):** payment review queue; render payment instructions from env; verify/reject buttons.
5. **M0-007 (Claude Code + MiniMax):** cleaner assignment + status transitions.
6. **M0-008 (QA + MiniMax):** Playwright E2E in EN/AR/DE; full M0 scenario.

### Owner / next action
- **MiniMax/frontend:** M0-004 PR (landing form). The exact prompt is being drafted in `docs/M0_REVIEW_000_003.md` §13.
- **Claude Code (primary; Codex on standby):** M0-002c (audit gate unblock) and M0-005 (dashboard calendar) in sequence.
- **Hermes:** review M0-004 when it lands. Do not expand scope.

---

## Hermes Review of M0-003b (2026-06-15)

### Verdict
**PASS** — start M0-004 (landing form real wiring). M0-003b closed the two open items from the M0-003 review.

### What M0-003b delivered
- `payments` and `payment_events` rows are only created for QUOTED bookings. COLLECTING_INFO and NEEDS_HUMAN bookings skip payment creation entirely. `bookings_v2.payment_status` is the NOT NULL placeholder `'UNPAID'`; the API response uses `paymentStatus: null` to distinguish "no payment row" from "real UNPAID, awaiting InstaPay".
- `checkSlotConflict(normalized)` runs inside the transaction, before any customer or booking writes, only when the draft status would be QUOTED. Past `scheduledStart` is downgraded to COLLECTING_INFO with `scheduledStart` in `missingFields`. Existing QUOTED/CONFIRMED/IN_PROGRESS at the same `scheduled_start` is rejected as NEEDS_HUMAN.
- Migration runner, M0-001 schema, and the 5 payment-safety triggers are byte-identical. Standing decision "AI never marks payment VERIFIED" remains enforced at 4 layers.
- 3 new tests; total 137 → 140 passing locally. The existing COLLECTING_INFO test was updated to expect no paymentId in the response.
- Live exercise confirmed all 7 scenarios (QUOTED happy, COLLECTING_INFO, past-time, slot conflict, VERIFIED poison, idempotency, row counts).

### Open items for the next PRs
1. **M0-004 (MiniMax, frontend):** wire the landing form. Handle three response shapes: `success: true, status: 'QUOTED'`; `success: true, status: 'COLLECTING_INFO', paymentStatus: null, missingFields: [...]`; `success: false` for past-time and slot-conflict. **No fake success fallback.** Handle 5xx with WhatsApp fallback. ~2 days.
2. **M0-005 (MiniMax + Claude Code):** dashboard reads from `bookings_v2` instead of legacy `bookings`. Calendar uses real booking data. Also: replace `checkSlotConflict`'s equality check with a window-overlap query (current shape is correct for hour-aligned form posts; chatbot path needs overlap). Add a malformed-date guard so `Number.isNaN(date.getTime())` returns COLLECTING_INFO instead of slipping through.
3. **M0-002c (Claude Code, parallel with M0-004):** resolve the pre-existing `service-agent` audit gate failure. The 6 high findings are in the `socket.io` → `engine.io` → `ws` chain via `@mastra/core` and are not introduced by M0-003b. Either upgrade `socket.io` (breaking, retest) or configure the audit gate to allow `service-agent` high findings with a documented waiver until M1.
4. **M0-006 (Claude Code):** payment review queue; render payment instructions from env; verify/reject buttons.
5. **M0-007 (Claude Code + MiniMax):** cleaner assignment + status transitions.
6. **M0-008 (QA + MiniMax):** Playwright E2E in EN/AR/DE; full M0 scenario.

### Owner / next action
- **MiniMax/frontend:** M0-004 PR. Form contract documented in `docs/M0_REVIEW_000_003b.md` §9.
- **Claude Code (parallel, optional):** M0-002c to unblock the audit gate.
- **Hermes:** review M0-004 when it lands. Do not expand scope.

---

## M0-004A Results (2026-06-15) — landed in parallel

- **Owner:** Hermes Coding (in parallel with M0-004B). Live form wiring.
- **Scope:** replace hardcoded `localhost:5000` fake-success fallback with real `POST /api/public/bookings` wiring, idempotency key, and explicit UI states. No fake success. Submit button is `disabled` + `aria-busy` during the request. Form is reset only on real `QUOTED` success.
- **Files:** `landing-page/src/features/booking-api.js` (new, 312 lines — discriminated `SubmitResult` with states `idle | loading | quoted | collecting_info | needs_human | duplicate | backend_error | network_error`), `landing-page/src/features/booking-form.js` (rewired), `landing-page/src/features/config.js` (new, `VITE_*` env plumbing), `landing-page/.env.example` (new), `landing-page/index.{en,ar,de}.html` (one-line addition of `<div id="bookingFormStatus" role="status" aria-live="polite" hidden>`), `landing-page/src/shared/styles.css` (minimal status-region block), `docs/M0_004A_QA_CHECKLIST.md` (new, 12-section manual QA).
- **Verification:** `landing-page npm ci` / `npm run build:all` / `npm audit --audit-level=high` = 0/0/0. Root builds clean.
- **Out of scope:** service-agent files, schema, migrations, payment code, dashboard, calendar, cleaner UI, social/marketing, new runtime deps.

## M0-004B Results (2026-06-16) — UI design layer

- **Owner:** MiniMax (Senior Engineer B / UI design builder). Frontend-only, design layer.
- **Scope:** UI polish for the landing booking form (field UX, mobile responsiveness, ARIA, i18n interpolation, privacy block); a richer result-state renderer that composes with M0-004A's `SubmitResult`; a design-only dashboard preview for the 7 sections.
- **Files added:** `landing-page/src/features/booking-result.js` (~250 lines, opt-in renderer for `#bookingFormStatus` region), `service-agent/public/m0-004b-design/{dashboard-preview.html, dashboard-preview.css, dashboard-preview.js, DESIGN_ONLY_MOCKS.js}` (4 files, design-only dashboard preview), `docs/design/M0_UI_DESIGN_NOTES.md` (full design contract).
- **Files changed:** `landing-page/src/i18n/{en,ar,de}.json` (added `bookingStates` keys — result copy, field hints, field labels, location types, conditions, privacy, error copy), `landing-page/src/shared/styles.css` (result-region sub-element styles, `human` and `loading` tone variants, form layout / field UX / mobile responsive), `landing-page/src/main.js` (mount result renderer), `landing-page/index.{en,ar,de}.html` (form restructured with field UX, ARIA, i18n interpolation, privacy block; `#bookingFormStatus` div preserved per M0-004A), `docs/AGENT_HANDOFF.md` (M0-004B entry under Completed Work + Current Controller Notes).
- **Files NOT changed:** `landing-page/src/features/booking-form.js` (Hermes-owned), `landing-page/src/features/booking-api.js` (Hermes-owned), `landing-page/src/features/config.js` (Hermes-owned), `service-agent/public/{index.html,app.js,style.css}` (live dashboard), any backend file, schema, migration, or payment trigger.
- **Composes with M0-004A:** the result renderer consumes the discriminated `SubmitResult` from `booking-api.js`. State names match exactly: `idle | loading | quoted | collecting_info | needs_human | duplicate | backend_error | network_error`. The renderer extends the existing `#bookingFormStatus` div (added by M0-004A) with sub-elements (icon, missing-fields pills, InstaPay block, primary/secondary CTAs) but does not replace M0-004A's `renderStatus()` helper. Hermes' submit handler can opt into the richer renderer by calling `window.renderBookingState(formElement, submitResult, { copy })` in place of her current `renderStatus()` call.
- **No fake success. No localhost. No `VERIFIED` in the UI.** The "AI never marks payment VERIFIED" decision is reflected in the customer-facing privacy block.
- **Dashboard preview is design-only.** All data lives in `DESIGN_ONLY_MOCKS.js`. The shipping dashboard is untouched. Reviewers can preview the 7 sections at `service-agent/public/m0-004b-design/dashboard-preview.html`.
- **Verification (in worktree):** `landing-page npm ci` / `npm run build:all` (3 langs) / `npm audit --audit-level=high` = 0/0/0. Root `npm ci` / `npm run build` / `npm audit --audit-level=high` = 0/0/0. 0 service-agent files touched.
- **Next:** M0-005 (MiniMax + Claude Code) — dashboard reads from `bookings_v2` instead of legacy `bookings`, calendar uses real booking data, replace `checkSlotConflict` equality check with window-overlap query, add malformed-date guard.
