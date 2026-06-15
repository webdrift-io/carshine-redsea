# Test Plan

> Status: **DRAFT v1.0** • Owner: QA agent (with Coding Engineer for unit + integration, Frontend for E2E)
> Real test pyramid, real coverage, real CI. The audit confirmed 126 tests pass — we need them to be the *right* tests.

---

## 1. Test pyramid (target shape)

```
            ╱╲
           ╱  ╲        E2E (Playwright)  — 12 tests
          ╱ 5% ╲       slow, brittle, last line of defense
         ╱──────╲
        ╱        ╲     Integration (Vitest + supertest)  — 40 tests
       ╱   20%    ╲    API + DB + Socket.io, no browser
      ╱────────────╲
     ╱              ╲  Unit (Vitest)  — 200+ tests
    ╱      75%       ╲ pure functions, fast, deterministic
   ╱──────────────────╲
```

**Hard rule:** every PR that drops below 60% line coverage in `service-agent/` fails CI. Every PR that breaks a "critical path" test (booking, payment, status machine) fails CI.

## 2. Test infrastructure

```
service-agent/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/                 (Playwright lives in /e2e, see §5)
│   ├── fixtures/
│   │   ├── schema.snapshot.sql
│   │   ├── conversations/*.json
│   │   └── mock-providers/{whatsapp,email,mem0,langfuse}.js
│   └── helpers/
│       ├── db.js
│       ├── server.js
│       └── tokens.js
```

- All tests use `:memory:` SQLite (or a per-test temp file with cleanup).
- All external providers are mocked behind interfaces; tests do not hit the real Meta / SMTP / Mem0 / Langfuse endpoints.
- All tests are deterministic — no `Date.now()` in production code, use an injected `clock`.
- Coverage: Vitest with `c8`/`v8`. Threshold: lines 60%, branches 55%, functions 60%.

## 3. Unit tests (≥ 200)

### 3.1 `agents/tools/*.test.js` (one file per tool)
- `customer_lookup.test.js`
- `customer_upsert.test.js`
- `vehicle_upsert.test.js`
- `slot_check.test.js`
- `booking_create.test.js`
- `booking_get.test.js`
- `booking_update_status.test.js`
- `booking_reschedule.test.js`
- `assign_staff.test.js`
- `payment_record_submission.test.js`
- `payment_verify.test.js`
- `handoff_to_human.test.js`
- `handoff_release.test.js`
- `send_message.test.js`
- `holiday_check.test.js`

Each covers: happy path, validation failure, role check, rate limit, idempotency (where applicable).

### 3.2 `agents/orchestrator.test.js`
- Deterministic path triggers correctly (no LLM tokens consumed for "what time are you open").
- LLM path triggers only when confidence < 0.7.
- Tool call limits enforced (max 5 tool calls per turn).
- Handoff path: bot never auto-replies when `handoff_active = 1`.

### 3.3 `migrations.test.js`
- Fresh DB: all migrations apply cleanly.
- Re-run: no new rows in `schema_migrations`.
- Schema matches the frozen snapshot.
- FKs are enforced (orphan insert throws).

### 3.4 `parsers.test.js`
- Date parsing: "tomorrow 10am", "بكرة الساعة 10", "morgen 10 Uhr" → ISO with offset.
- Phone parsing: `010…`, `+20 10…`, `0020 10…` → E.164.
- Address: extracts area (El Gouna, Hurghada, Sahl Hasheesh) from free text.

### 3.5 `messages/templates.test.js`
- All templates render in EN + AR + DE without throwing.
- All required vars are present in the rendered output (no `{{undefined}}`).
- No English literals leak into Arabic/German templates.

### 3.6 `payments/state.test.js`
- State machine: valid transitions accepted, invalid rejected.
- Append-only `payment_events` triggers work (UPDATE/DELETE throw).

### 3.7 `bookings/state.test.js`
- Same as above for booking status machine.
- Cleaner can only transition their own assignment.
- Customer can only `CANCELLED_BY_CUSTOMER`, not `CANCELLED_BY_OWNER`.

### 3.8 `auth.test.js`
- bcrypt verify.
- JWT sign/verify.
- Dev bypass gated correctly.
- Role check middleware.

### 3.9 `integrations/instapay.test.js`
- `getInstructions` returns the right shape.
- Missing env → clear error, not a silent fallback.

## 4. Integration tests (≥ 40)

These run the full Express app against an in-memory DB. No browser, no LLM (LLM is mocked).

### 4.1 Public APIs
- `POST /api/public/bookings` happy path → 201, returns `public_ref`, `payment_instructions`.
- `POST /api/public/bookings` with missing fields → 400, returns the missing-field list.
- `POST /api/public/bookings` idempotency: same key twice → same `public_ref`.
- `POST /api/public/chat` returns a chat session id.
- `POST /api/public/chat` with a deterministic trigger (e.g. "what time are you open") → no LLM call.
- `POST /api/public/chat` with a "book a wash" intent → orchestrator calls `customer_upsert` + `slot_check` + `booking_create`.
- `POST /api/public/inbound/whatsapp` (webhook) → creates chat session, calls orchestrator.

### 4.2 Owner APIs (auth required)
- `POST /api/auth/login` valid → 200 + JWT; invalid → 401.
- `GET /api/admin/bookings` returns paginated list.
- `POST /api/admin/bookings/:id/approve` → state machine moves, history row written, Socket.io emits.
- `POST /api/admin/bookings/:id/reject` → state machine moves, calendar event removed.
- `POST /api/admin/payments/:id/verify` → payment status, customer message sent.
- `POST /api/admin/payments/:id/reject` without reason → 400.
- `POST /api/admin/staff/:id/assign` → assignment row created, booking `ASSIGNED`.
- `GET /api/admin/integrations/status` → returns live provider state.

### 4.3 Cleaner APIs
- Cleaner login → JWT with `role = CLEANER`.
- `GET /api/cleaner/jobs` returns only that cleaner's jobs.
- `POST /api/cleaner/jobs/:id/status` with valid transition → 200; invalid → 400.
- Cleaner cannot transition a booking not assigned to them → 403.

### 4.4 Socket.io
- `booking:created` emitted on `POST /api/public/bookings`.
- `booking:updated` emitted on status change.
- `payment:updated` emitted on verify/reject.
- `chat:message` emitted on outbound message.

### 4.5 Migration + seed
- Migration runner on a fresh DB produces the documented schema.
- Seed script (gated on `NODE_ENV !== 'production'`) populates the demo data.

## 5. E2E tests (Playwright, 12 tests, 3 languages)

E2E lives at the repo root in `e2e/`. It boots the full stack (server + dashboard + landing) in headless Chromium + WebKit + Firefox. Three locales: `en`, `ar`, `de`.

### 5.1 Critical paths
1. **E2E-01** (en, customer, web form): Fill the landing booking form → assert 201 from `/api/public/bookings` → assert the success page shows `public_ref` → assert a chat_session row exists.
2. **E2E-02** (ar, customer, chatbot): Open chatbot widget → ask "عايز أحجز غسيل بكرة الساعة 10" → assert intake questions in Egyptian Arabic → confirm → assert booking created with `public_ref`.
3. **E2E-03** (de, customer, chatbot): Open chatbot → "Ich möchte morgen um 10 Uhr eine Wäsche buchen" → assert German intake → confirm → assert booking.
4. **E2E-04** (en, owner, dashboard login + approve): Login → see today's bookings → click approve on a `PENDING_CONFIRMATION` → assert status moves to `CONFIRMED` and the customer is shown in the "Confirmed" column.
5. **E2E-05** (en, owner, payment verify): Open the pending-payment queue → click Approve on a row → assert `payments.status = VERIFIED` and the customer gets a `PAYMENT_VERIFIED` message.
6. **E2E-06** (en, owner, assign cleaner): Open a `PAID` booking → assign to Mahmoud → assert cleaner view shows the booking.
7. **E2E-07** (ar, cleaner, status update): Login as Mahmoud → mark the job `EN_ROUTE` → assert customer message is logged → mark `ON_SITE` → mark `IN_PROGRESS` → mark `COMPLETED` → assert `JOB_COMPLETED` message is logged.
8. **E2E-08** (en, customer, public status page): Open `/b/<ref>?t=<token>` → see the timeline → click Cancel → assert cancellation flow.
9. **E2E-09** (en, owner, take over chat): Open conversations → click "Take over" → assert the bot stops replying → owner sends a message → assert it appears in the customer's channel.
10. **E2E-10** (de, customer, reschedule): Public status page → click Reschedule → pick a new slot → assert atomic move.
11. **E2E-11** (en, owner, RTL toggle): Toggle dashboard language to AR → assert `dir="rtl"` on `<html>` → assert sidebar moves to the right.
12. **E2E-12** (en, full scenario): End-to-end: web form book → confirm → submit InstaPay proof → owner verify → assign → cleaner drives + completes → customer receives thank-you. **This is the "MVP is done" test.**

### 5.2 E2E rules
- All tests use data-testid attributes; no CSS selectors that depend on Three.js / GSAP.
- All tests run against a clean seed DB; each test gets a fresh server (via Playwright's `webServer` config).
- All tests assert no `console.error` events.
- AR tests assert `document.documentElement.dir === 'rtl'` on every page they load.

## 6. Test gates (CI)

A PR cannot merge unless:

- [ ] Unit + integration tests pass
- [ ] Coverage gate (60% lines)
- [ ] Lint clean
- [ ] Typecheck clean
- [ ] Migrations apply cleanly on a fresh DB
- [ ] All 12 E2E tests pass on at least Chromium + WebKit
- [ ] No new `console.error` in any rendered page
- [ ] No `META_*` env names left in code (CLEANUP gate)

## 7. Regression & smoke

- `npm run smoke` (added in M0) starts the server and curls `/health`, `/api/public/services`, `/api/integrations/status`. Returns non-zero on any failure.
- Nightly: a separate workflow spins up the server, runs the seed, sends a simulated WhatsApp message end-to-end, asserts a `bookings` row. Posts to a Slack/email channel.

## 8. Performance budgets

- `POST /api/public/bookings` p95 < 400ms (no LLM).
- `POST /api/public/chat` p95 < 1.2s with LLM, < 80ms deterministic path.
- Dashboard "Today" p95 < 600ms with 200 bookings.
- Calendar "Day" view p95 < 400ms.

These are tested with `autocannon` in a separate workflow; soft-fails for now, hard-fails in M1.

## 9. Acceptance for the test plan

- 200+ unit tests, 40+ integration tests, 12 E2E tests all green in CI.
- Coverage report visible in PR.
- E2E-12 (full scenario) is the "MVP done" gate. It must pass 5 days in a row before M0 is declared shipped.
- A new agent (any of Codex, MiniMax, QA, Security) can run `npm test` and get a green ✅ locally without external services.

## 10. Open questions

| # | Question | Owner | Due |
|---|---|---|---|
| Q1 | WebKit + Firefox in E2E: both required, or Chromium-only? | QA | Day 3 |
| Q2 | Visual regression: Percy / Playwright screenshot diff? | Frontend | Day 5 |
| Q3 | Load test tool: k6, autocannon, or artillery? | Coding Engineer | Day 5 |
| Q4 | Do we add a fuzz test for the orchestrator's tool router? | QA | Day 7 |
