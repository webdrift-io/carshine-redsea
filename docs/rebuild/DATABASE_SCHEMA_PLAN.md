# Database Schema Plan

> Status: **DRAFT v1.0** • Owner: Coding Engineer (DB agent) + Security sign-off
> Goal: turn the audit's "missing tables" list into a real, normalized, migration-driven schema that the rest of the rebuild can build on.

---

## 1. Ground rules

1. **Migrations are the only way to change the schema.** No `CREATE TABLE` in `database.js` except a thin `PRAGMA` + migration runner.
2. **Migrations are forward-only in M0.** No destructive drops. The old `calendar_events` table becomes read-only and is dropped in M1.
3. **Migrations are idempotent.** Re-running them on a fresh DB and on a partially-migrated DB both produce the same end state.
4. **All timestamps are stored as ISO-8601 strings with timezone (`...+02:00`)**. We render in `Africa/Cairo` by default. No Unix epoch integers.
5. **Soft delete is the default.** `deleted_at` nullable. Hard delete is reserved for GDPR-style customer-initiated removal.
6. **Foreign keys are enforced** (`PRAGMA foreign_keys = ON` at connection open).
7. **Money is stored as integer piasters (or cents).** Never as float. Currency code in a column.
8. **Phone numbers are stored in E.164** when known, with a `phone_raw` column for the local format the customer typed.

## 2. Migration file layout

```
service-agent/
├── migrations/
│   ├── 000_migrations.js        # tracks applied migrations
│   ├── 001_create_handoff_tickets.js  # already exists
│   ├── 010_normalize_identity.js
│   ├── 020_services_and_pricing.js
│   ├── 030_bookings_v2.js
│   ├── 040_payments.js
│   ├── 050_staff_and_assignments.js
│   ├── 060_messages.js
│   ├── 070_audit_and_agent_actions.js
│   ├── 080_calendar_readonly_view.js
│   └── 090_seed_dev_data.js
```

**Implemented M0 naming note:** the non-destructive M0 foundation keeps the
legacy `bookings`, `chat_sessions`, and `chat_messages` tables unchanged for
one release. Normalized replacements therefore use v2 suffixes where needed:
`bookings_v2`, `conversations_v2`, and `messages_v2`. This preserves legacy data
and lets routes migrate gradually. Legacy tables remain preserved until the app
fully moves to the normalized model.

Each migration exports:
```js
module.exports = {
  id: '010_normalize_identity',
  up(db) { /* ... */ },
  down(db) { /* ... */ }  // optional, used in tests only
};
```

`database.js` exposes `migrate()` which:
1. Ensures `schema_migrations(id TEXT PRIMARY KEY, applied_at TEXT)`.
2. Lists `migrations/*.js` in order.
3. For each not in `schema_migrations`, runs `up(db)` inside a transaction, then records the id.
4. Wraps the whole run in a single transaction per migration (atomic).

## 3. Entity-relationship overview

```
                 ┌──────────┐
                 │  users   │  (admin, dispatcher, cleaner — single auth table)
                 └────┬─────┘
                      │ role
        ┌─────────────┼──────────────┐
        ▼             ▼              ▼
   (admin)      (dispatcher)      (cleaner)
                      │
                      │ owns
                      ▼
   ┌──────────┐  1..N  ┌───────────┐  1..1   ┌─────────┐
   │ customers├───────►│ bookings  ├───────►│ vehicles│
   └────┬─────┘        └─────┬─────┘        └─────────┘
        │                    │
        │                    │ 1..N
        │                    ▼
        │              ┌──────────────┐
        │              │ assignments  │  ─── staff_id ──► users
        │              └──────────────┘
        │                    │
        │                    │ 1..N
        │                    ▼
        │             ┌─────────────────────┐
        │             │ booking_status_hist │
        │             └─────────────────────┘
        │
        │                    ┌─────────────┐
        └───────────────────►│   payments  │
                             └──────┬──────┘
                                    │ 1..N
                                    ▼
                             ┌─────────────┐
                             │payment_evts │  (immutable audit)
                             └─────────────┘

   ┌──────────────┐ 1..N ┌──────────────┐
   │chat_sessions ├─────►│chat_messages │
   └──────┬───────┘      └──────────────┘
          │ 0..1
          ▼
   ┌──────────────────┐
   │ handoff_tickets  │
   └──────────────────┘

   ┌──────────────┐ 1..N ┌──────────────┐
   │  messages    ├─────►│message_evts  │  (provider delivery)
   └──────────────┘      └──────────────┘
```

## 4. Table-by-table spec

Conventions: `id` is `TEXT` (UUID v4 generated app-side). `created_at` and `updated_at` on every table.

### 4.1 `users`
Replaces the implicit "admin" model. Single auth table for every role.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `email` | TEXT UNIQUE NOT NULL | |
| `phone` | TEXT | E.164 |
| `password_hash` | TEXT NOT NULL | bcrypt cost ≥ 10 |
| `role` | TEXT NOT NULL | `OWNER` \| `DISPATCHER` \| `CLEANER` |
| `display_name` | TEXT NOT NULL | |
| `language` | TEXT | `en` \| `ar` \| `de` |
| `active` | INTEGER NOT NULL DEFAULT 1 | |
| `shift_start` | TEXT | e.g. `09:00` (local) |
| `shift_end` | TEXT | e.g. `17:00` |
| `last_login_at` | TEXT | |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |
| `deleted_at` | TEXT | |

Indexes: `idx_users_role`, `idx_users_active`.

### 4.2 `customers`
Normalized customer record. **One row per real person, not per chat session.**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `full_name` | TEXT NOT NULL | |
| `phone_e164` | TEXT | |
| `phone_raw` | TEXT | |
| `email` | TEXT | |
| `language` | TEXT | `en` \| `ar` \| `de` |
| `address` | TEXT | Free text, the location they want washed at |
| `area` | TEXT | El Gouna, Hurghada, Sahl Hasheesh, etc. |
| `notes` | TEXT | |
| `tags` | TEXT | JSON array (e.g. `["vip","repeat"]`) |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |
| `deleted_at` | TEXT | |

Indexes: `idx_customers_phone` (phone_e164), `idx_customers_email`, `idx_customers_area`.

**Dedup rule:** On booking creation, if `phone_e164` matches an existing customer, reuse; else create. Same for email.

### 4.3 `vehicles`

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `customer_id` | TEXT NOT NULL | FK → customers.id |
| `car_type` | TEXT NOT NULL | `SEDAN` \| `SUV` \| `PICKUP` \| `VAN` \| `OTHER` |
| `make` | TEXT | |
| `model` | TEXT | |
| `color` | TEXT | |
| `plate` | TEXT | |
| `notes` | TEXT | |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |
| `deleted_at` | TEXT | |

Indexes: `idx_vehicles_customer_id`.

A customer can have many vehicles. A booking references one vehicle.

### 4.4 `services`
The product catalog. **Replaces "payment" being a free string.**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `code` | TEXT UNIQUE NOT NULL | e.g. `EXTERIOR_SEDAN` |
| `name_en` | TEXT NOT NULL | |
| `name_ar` | TEXT NOT NULL | |
| `name_de` | TEXT NOT NULL | |
| `description_en` | TEXT | |
| `description_ar` | TEXT | |
| `description_de` | TEXT | |
| `duration_minutes` | INTEGER NOT NULL | |
| `price_amount` | INTEGER NOT NULL | in piasters |
| `price_currency` | TEXT NOT NULL DEFAULT 'EGP' | |
| `active` | INTEGER NOT NULL DEFAULT 1 | |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |
| `deleted_at` | TEXT | |

Seed: at least 4 services (exterior sedan, exterior SUV, interior add-on, full detail).

### 4.5 `bookings_v2`
The core operational record. **Existing `bookings` is preserved; normalized M0 rows live in `bookings_v2` for one-release compatibility.**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `public_ref` | TEXT UNIQUE NOT NULL | Short, customer-facing, e.g. `CR-20260615-001` |
| `customer_id` | TEXT NOT NULL | FK |
| `vehicle_id` | TEXT | FK, nullable until intake complete |
| `service_id` | TEXT NOT NULL | FK |
| `scheduled_start` | TEXT NOT NULL | ISO-8601 with offset |
| `scheduled_end` | TEXT NOT NULL | ISO-8601, derived from service duration |
| `timezone` | TEXT NOT NULL DEFAULT 'Africa/Cairo' | |
| `status` | TEXT NOT NULL | see §5 |
| `payment_status` | TEXT NOT NULL | see §6 |
| `source` | TEXT NOT NULL | `WEB_FORM` \| `CHATBOT` \| `WHATSAPP` \| `EMAIL` \| `OWNER` |
| `language` | TEXT | |
| `notes` | TEXT | |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |
| `deleted_at` | TEXT | |

Indexes: `idx_bookings_scheduled_start`, `idx_bookings_status`, `idx_bookings_customer_id`, `idx_bookings_payment_status`.

### 4.6 `booking_status_history`
Append-only audit of every status change.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `booking_id` | TEXT NOT NULL | FK |
| `from_status` | TEXT | null if it's the first event |
| `to_status` | TEXT NOT NULL | |
| `actor_type` | TEXT NOT NULL | `SYSTEM` \| `AI` \| `USER` \| `CLEANER` \| `OWNER` |
| `actor_id` | TEXT | user.id or null for AI/SYSTEM |
| `reason` | TEXT | |
| `metadata` | TEXT | JSON, e.g. tool calls, payloads |
| `created_at` | TEXT NOT NULL | |

### 4.7 `staff` (alias view of `users` where role != OWNER) — *see decision below*

**Decision:** We do **not** create a separate `staff` table. We use `users` with `role IN ('DISPATCHER','CLEANER')`. The audit's "staff/cleaners" gap is closed by the new `users` table. The downstream code does:

```sql
SELECT * FROM users WHERE role IN ('CLEANER','DISPATCHER') AND active = 1 AND deleted_at IS NULL;
```

This avoids a duplicate identity model. The `assignments` table joins to `users.id`.

### 4.8 `assignments`
Many-to-one: a booking has 0..N assignments over time (re-assignment is allowed).

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `booking_id` | TEXT NOT NULL | FK |
| `staff_id` | TEXT NOT NULL | FK → users.id |
| `assigned_at` | TEXT NOT NULL | |
| `assigned_by` | TEXT | user.id (owner/dispatcher) |
| `released_at` | TEXT | |
| `release_reason` | TEXT | |
| `created_at` | TEXT NOT NULL | |

A cleaner can be the primary on multiple bookings, but no cleaner has overlapping `scheduled_start`–`scheduled_end` ranges. The SlotValidator enforces this.

### 4.9 `payments`
**The table that fixes the "payment is a string" problem.**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `booking_id` | TEXT NOT NULL UNIQUE | FK, one payment per booking in M0 |
| `method` | TEXT NOT NULL | `INSTAPAY` \| `CASH` \| `OTHER` |
| `amount` | INTEGER NOT NULL | piasters |
| `currency` | TEXT NOT NULL DEFAULT 'EGP' | |
| `status` | TEXT NOT NULL | see §6 |
| `reference` | TEXT | Customer-typed InstaPay reference / transaction id |
| `screenshot_url` | TEXT | Local or S3-style URL |
| `submitted_at` | TEXT | |
| `verified_by` | TEXT | FK → users.id |
| `verified_at` | TEXT | |
| `rejection_reason` | TEXT | |
| `created_at` | TEXT NOT NULL | |
| `updated_at` | TEXT NOT NULL | |

### 4.10 `payment_events`
Immutable audit log. **Append-only — no UPDATE, no DELETE.**

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `payment_id` | TEXT NOT NULL | FK |
| `event_type` | TEXT NOT NULL | `CREATED` \| `SUBMITTED` \| `VERIFIED` \| `REJECTED` \| `REOPENED` |
| `actor_type` | TEXT NOT NULL | `SYSTEM` \| `CUSTOMER` \| `OWNER` \| `CLEANER` |
| `actor_id` | TEXT | |
| `metadata` | TEXT | JSON |
| `created_at` | TEXT NOT NULL | |

Trigger to enforce append-only:
```sql
CREATE TRIGGER payment_events_no_update BEFORE UPDATE ON payment_events
BEGIN SELECT RAISE(ABORT, 'payment_events is append-only'); END;
CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON payment_events
BEGIN SELECT RAISE(ABORT, 'payment_events is append-only'); END;
```

### 4.11 `holidays`
Empty in M0, populated in M1. SlotValidator already references it.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `date` | TEXT NOT NULL UNIQUE | `YYYY-MM-DD` |
| `name` | TEXT | |
| `closed` | INTEGER NOT NULL DEFAULT 1 | |

### 4.12 `messages_v2` + future `message_events`
The "we sent a WhatsApp" record, so the dashboard can show real delivery state.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `customer_id` | TEXT | FK |
| `booking_id` | TEXT | FK, optional |
| `channel` | TEXT NOT NULL | `WHATSAPP` \| `EMAIL` \| `SMS` \| `WEB_CHAT` |
| `direction` | TEXT NOT NULL | `INBOUND` \| `OUTBOUND` |
| `template_code` | TEXT | e.g. `BOOKING_CONFIRMED` |
| `language` | TEXT | |
| `subject` | TEXT | email only |
| `body` | TEXT NOT NULL | |
| `provider` | TEXT | `META` \| `TWILIO` \| `SMTP` |
| `provider_message_id` | TEXT | |
| `delivery_status` | TEXT | `QUEUED` \| `SENT` \| `DELIVERED` \| `READ` \| `FAILED` |
| `created_at` | TEXT NOT NULL | |

`message_events` mirrors `payment_events`: append-only, trigger-enforced, stores status transitions as they come back from the provider.

### 4.13 `conversations_v2` + legacy `chat_sessions` / `chat_messages`
**Keep the existing tables. Add normalized v2 tables; don't replace legacy chat storage yet.**

Normalized `conversations_v2` includes:
- `customer_id` TEXT FK (nullable, set when matched)
- `handoff_active` INTEGER DEFAULT 0
- `handoff_owner_id` TEXT FK
- `channel` TEXT — `WEB_CHAT` | `WHATSAPP` | `EMAIL`
- `language` TEXT

Normalized `messages_v2` includes:
- `customer_id` TEXT FK (denormalized for analytics)
- `tool_calls` TEXT (JSON)
- `tokens_in` INTEGER, `tokens_out` INTEGER

### 4.14 `agent_actions`
**New.** Audit log of every tool call the AI made, for security + product analytics.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `chat_session_id` | TEXT | FK |
| `tool_name` | TEXT NOT NULL | |
| `input` | TEXT | JSON |
| `output` | TEXT | JSON |
| `success` | INTEGER NOT NULL | |
| `latency_ms` | INTEGER | |
| `actor_type` | TEXT NOT NULL | `AI` |
| `created_at` | TEXT NOT NULL | |

### 4.15 `handoff_tickets`
**Already exists** (`001_create_handoff_tickets.js`). Add columns: `priority`, `sla_due_at`, `first_response_at`, `resolved_at`, `customer_id` FK.

### 4.16 `integrations_status`
Not a table, a derived view: `service-agent/integrations.js` exposes `/api/integrations/status` that returns live status per provider (WhatsApp, Email, Mem0, Langfuse). M0 stores nothing; M1 may add a snapshot table.

### 4.17 Tables NOT created in M0 (intentional)

- `social_posts`, `social_analytics` — left untouched, **not read by M0 code paths**. (See `CLEANUP_PLAN.md` §11.)
- `subscriptions`, `coupons`, `referrals` — Phase 2.
- `audit_log_general` — we use per-domain audit tables (`booking_status_history`, `payment_events`, `message_events`, `agent_actions`) for stronger domain ownership.

## 5. Booking status machine (canonical)

```
INTAKE_INCOMPLETE ─► PENDING_CONFIRMATION ─► CONFIRMED ─► ASSIGNED ─► EN_ROUTE ─► ON_SITE ─► IN_PROGRESS ─► COMPLETED
        │                    │                  │            │                                 │
        │                    │                  │            │                                 ▼
        │                    │                  │            │                            PAYMENT_VERIFIED
        │                    │                  │            │
        │                    │                  │            ▼
        │                    │                  │        NO_SHOW
        │                    │                  │
        │                    │                  ▼
        │                    │             PAYMENT_PENDING_REVIEW
        │                    │                  │
        │                    │                  ├──► PAID  (when verified)
        │                    │                  └──► UNPAID (when rejected; customer re-pays)
        │                    │
        │                    ▼
        │               CANCELLED_BY_CUSTOMER  / CANCELLED_BY_OWNER
        │
        ▼
   ABANDONED  (intake never completed; nightly cleanup)
```

Payment status and booking status are **two separate columns**. The UI composes them; the data doesn't conflate them.

## 6. Payment status (canonical)

```
UNPAID ─► PENDING_REVIEW ─► VERIFIED
   ▲              │
   │              └──► REJECTED ─► (back to UNPAID if booking re-opens)
   │
   └── CASH_ON_COMPLETION (special case: only set when cleaner marks COMPLETED with method = CASH and no prior review row)
```

## 7. Seed data (dev only — gated by `NODE_ENV !== 'production'`)

`migrations/090_seed_dev_data.js`:
- 1 owner: `owner@carshineredsea.com` / `ChangeMe123!` (password hash)
- 1 dispatcher: `dispatch@example.com`
- 2 cleaners: `mahmoud@example.com`, `hany@example.com`
- 4 services: `EXTERIOR_SEDAN`, `EXTERIOR_SUV`, `INTERIOR_ADDON`, `FULL_DETAIL`
- 1 demo customer + 1 demo booking
- 2 holidays (Coptic Christmas Jan 7, Sinai Liberation Apr 25)

Seed is **never** run in production. The migration runner checks `NODE_ENV`.

## 8. Migration test (acceptance for the schema)

A single integration test in `service-agent/tests/migrations.test.js`:

1. Spin up an in-memory SQLite (`better-sqlite3` `:memory:`).
2. Run all migrations in order.
3. Compare resulting schema (using `sqlite_master`) to a frozen snapshot file `tests/fixtures/schema.snapshot.sql`.
4. Re-run migrations; assert no new rows in `schema_migrations` were created.
5. Insert one row into every table using only the documented columns; assert inserts succeed and FKs reject orphans.

This test **must** pass in CI before any Phase 1 PR merges.

## 9. Data migration from old `bookings` → `bookings` v2

For each row in the existing `bookings` table:
1. If `customer_name` and `phone` are present, create or match a `customers` row.
2. Map `service` (current free string) to a `services` row by `code` (best-effort; if no match, create a `MISC` service).
3. Create a `vehicles` row only if `car_type` is set.
4. Insert into the new `bookings_v2` with `public_ref` = `LEGACY-<old_id>`.
5. Insert a `booking_status_history` row with `from_status = null`, `to_status = old.status`, `actor_type = 'SYSTEM'`, `reason = 'pre-rebuild migration'`.

This is wrapped in `migrations/030_bookings_v2.js` `up()`. Old table is left intact for one release.

## 10. What this schema does not promise

- No multi-tenancy.
- No internationalization of currency (EGP only in M0).
- No timezone other than `Africa/Cairo` (rows store offset; conversion is render-time).
- No data warehouse / analytics table. Langfuse covers AI observability; SQLite is the source of truth for ops.

## 11. Open questions (to resolve before M0 day 3)

| # | Question | Owner | Due |
|---|---|---|---|
| Q1 | Do we need `bookings` v1 table kept read-only for one release, or can we drop it after data migration? | Coding Engineer | Day 2 |
| Q2 | Currency: store in EGP only, or generic currency column? | Product | Day 1 |
| Q3 | `public_ref` format: `CR-YYYYMMDD-NNN` daily, or monotonic global? | Coding Engineer | Day 2 |
| Q4 | Should `customers.address` be a single text or split (street / area / building / floor / notes)? | Product + Coding Engineer | Day 3 |
| Q5 | Do we need a `vehicles.plate` UNIQUE constraint, or soft-unique per customer? | Product | Day 3 |
