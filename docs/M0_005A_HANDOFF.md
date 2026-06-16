# M0-005a Handoff: Backend Read Model + Slot-Overlap Refinement

> Status: **ACTIVE HANDOFF** • From: Hermes PM • To: Hermes Coding (Claude Code)
> Date: 2026-06-16
> Activated: 2026-06-16, immediately after M0-004 merged (commit `2819c12`).
> Plan reference: `docs/M0_REVIEW_PLAN_000_005.md` (12 sections). This file is the **executable subset** — paste-ready prompt + verification.

---

## 0. Mission in one line

Build a real, read-only API for the owner dashboard to consume, and refine the public-booking slot check to be a real window-overlap query with a malformed-date guard. **No schema changes. No frontend changes. No payment-trigger changes.**

---

## 1. The paste-ready prompt

> ## M0-005a — Backend read model + slot-overlap refinement
>
> **Background.** M0-000 → M0-004 are merged. M0-001 schema is in production. M0-003 public booking API writes real `customers`, `vehicles`, `bookings_v2`, `payments`, `payment_events`, `booking_status_history` rows. M0-003b added `checkSlotConflict` (equality-based) and the COLLECTING_INFO payment-skip. M0-004 wired the landing form. M0-005a is the backend read model the dashboard will consume in M0-005b, and the slot-overlap refinement that closes M0-003b N2 + N3.
>
> **Standing decisions (do not violate):**
> 1. Preserve legacy data. Do not drop, rename, or alter `bookings`, `calendar_events`, `chat_sessions`, `chat_messages`, `admin_credentials`, `social_posts`, `social_analytics`.
> 2. Migrations are forward-only and non-destructive in M0. **M0-005a is READ-ONLY on the schema.** No new tables, no new columns, no new triggers, no new indexes via this PR.
> 3. AI must never mark a payment VERIFIED. The DB triggers enforce this; do not weaken them.
> 4. No InstaPay API; manual owner verification only.
> 5. Social/marketing stays Phase 2.
> 6. v2 naming (`bookings_v2`, `conversations_v2`) is the M0 convention; do not rename.
> 7. The legacy `/api/bookings`, `/api/calendar`, `/api/bookings/:id/approve`, `/api/bookings/:id/reject` routes **stay alive**. M0-005b deprecation is a separate ticket.
> 8. M0-005a does **not** add M0-007 state-machine statuses (ASSIGNED, EN_ROUTE, ON_SITE, IN_PROGRESS, COMPLETED, NO_SHOW). Read only the actual schema statuses.
> 9. Owner JWT scope: `requireRole(['OWNER', 'DISPATCHER'])` for reads, `requireRole(['OWNER'])` for reschedule.
> 10. Africa/Cairo timezone is the only render timezone.
>
> ### M0-005a — Backend
>
> **New files:**
> - `service-agent/services/admin-bookings-read.js` — read-only query layer. Three exports:
>   - `listBookingsForAdmin({ dateFrom, dateTo, status, paymentStatus, source, language, limit, offset })` → `{ success, count, bookings, hasMore }`.
>   - `getBookingDetailForAdmin(bookingV2Id)` → `{ success, booking }`. Includes the most recent 50 `booking_status_history` rows and the most recent 20 `payment_events` rows.
>   - `getCalendarForAdmin({ dateFrom, dateTo })` → `{ success, events: [...] }`. Narrower projection (id, publicRef, status, paymentStatus, scheduledStart, scheduledEnd, customerId, vehicleId, servicePackageId).
>   - `formatBookingForAdmin(row)` — pure formatter. See response shape in `docs/M0_REVIEW_PLAN_000_005.md` §4.1. Includes `customer`, `vehicle` (null if none), `servicePackage` (tri-lingual names), `payment` (null when not created), `assignment: null` (always null in M0-005a), `missingFields` (parsed from `bookings_v2.notes` if status is COLLECTING_INFO — comment in code that this is a temporary shim and a dedicated column lands in M0-005b), `needsHuman` (boolean).
> - `service-agent/services/slot-overlap.js` — `findOverlappingBookings({ scheduledStart, scheduledEnd, excludeBookingId })` and `assertNoSlotConflict(normalized, servicePackage, now)`. The window-overlap query is in `docs/M0_REVIEW_PLAN_000_005.md` §6.1. The malformed-date guard is in §6.2.
> - `service-agent/tests/admin-bookings-read.test.js` — 7 tests: (1) list returns shape with mixed-status bookings, payment null for COLLECTING_INFO, missingFields parsed; (2) date range filter; (3) status/paymentStatus filter; (4) limit+offset pagination; (5) detail returns history in reverse chronological order; (6) detail returns payment_events for the linked payment; (7) calendar returns the narrower projection.
> - `service-agent/tests/slot-overlap.test.js` — 6 tests: (1) 60-min @10:00 vs 60-min @10:30 → conflict; (2) 75-min @10:00 vs 60-min @10:45 → conflict; (3) back-to-back at end → no conflict; (4) CANCELLED_* and ABANDONED are ignored; (5) malformed scheduledStart returns COLLECTING_INFO; (6) past scheduledStart returns COLLECTING_INFO with `scheduledStart` in missingFields.
>
> **Modified files:**
> - `service-agent/services/public-bookings.js` — replace `checkSlotConflict(normalized)` with the new `assertNoSlotConflict(normalized, servicePackage, now)`. The return shape is the same; the caller in `createPublicBooking` is updated to pass `servicePackage`. **No behavior change for callers**; existing M0-003b tests continue to pass.
> - `service-agent/routes/admin.js` — add four new routes:
>   - `GET /api/admin/bookings-v2` — list. Filters: `dateFrom`, `dateTo` (ISO), `status` (single, repeatable), `paymentStatus` (single, repeatable), `source`, `language`, `limit` (default 50, max 500), `offset` (default 0). RBAC: OWNER/DISPATCHER.
>   - `GET /api/admin/bookings-v2/:id` — detail. RBAC: OWNER/DISPATCHER.
>   - `GET /api/admin/calendar-v2` — calendar projection. Filters: `dateFrom`, `dateTo` (required, ISO). RBAC: OWNER/DISPATCHER.
>   - `POST /api/admin/bookings-v2/:id/reschedule` — body `{ newScheduledStart: ISO, reason?: string }`. RBAC: OWNER only. Calls `assertNoSlotConflict`. On success: updates `bookings_v2.scheduled_start` and `scheduled_end` in a transaction, writes a `booking_status_history` row with `reason: 'reschedule'` and `actor_type: 'OWNER'`, emits `booking:updated` via Socket.io. On failure: 409 `{ success: false, code: 'SLOT_UNAVAILABLE', message, suggestedSlots: [] }` (empty array for M0-005a; populating suggestions is M0-005b polish).
> - `service-agent/server.js` — mount the new admin routes. **Do not touch the legacy routes.**
> - `service-agent/database.js` — add prepared-statement helpers only. **No schema changes, no new indexes via this PR.** If a query is slow, that is a follow-up M0-005b, not this PR.
> - `service-agent/tests/public-bookings-m0.test.js` — extend with 1 new test: `rejects overlap, not just exact match` (10:00 QUOTED booking, 10:30 attempt, assert NEEDS_HUMAN).
> - `docs/M0_STATUS.md`, `docs/AGENT_HANDOFF.md`, `docs/IMPLEMENTATION_QUEUE.md` — milestone updates at the end of the PR.
>
> **Hard rules:**
> - **No migrations in this PR.** If you need a new index, that's a follow-up M0-005b.
> - **No raw SQL string interpolation.** All queries use `db.prepare` with bound parameters.
> - **Do not remove or rename any legacy route.**
> - **Do not change the M0-001 schema or the 5 payment-safety triggers.**
> - **Do not introduce a new npm dependency.**
> - **Do not change the public endpoint's response shape.**
> - **Do not touch the dashboard, the landing page, or the AI orchestrator.**
> - **Do not change the JWT secret length, the dev-bypass env gating, or any other security primitive.**
>
> **Acceptance for M0-005a:**
> - All 140 existing tests pass.
> - 13 new tests pass (7 read + 6 overlap).
> - Total `service-agent` test count goes 140 → 153.
> - A live exercise (run on a temp DB) confirms: list returns 0 rows on empty DB, list returns correct shape with 3 mixed-status bookings, detail returns history + payment events, calendar returns the narrower projection, reschedule rejects past + conflict + malformed, RBAC blocks a CLEANER JWT.
> - Lint clean, typecheck clean.
> - Legacy `/api/bookings` and `/api/calendar` still work; the new endpoints are additive.
> - `docs/M0_STATUS.md` M0-005a section is written; the M0-005a status row is updated.
> - `docs/AGENT_HANDOFF.md` M0-005a subsection is added; the "Recommended next PRs" list is updated.
> - `docs/IMPLEMENTATION_QUEUE.md` M0-005a line is flipped to DONE; M0-005b and M0-005c remain NOT STARTED.
>
> ### What Hermes Coding should NOT do
> - **Do not start M0-005b (dashboard SPA swap).** That's MiniMax's job, after M0-005a merges.
> - **Do not start M0-006 (payment review) or M0-007 (cleaner assignment) in this PR.**
> - **Do not change the M0-001 schema, the migration runner, or the payment-safety triggers.**
> - **Do not add a new npm dependency.**
> - **Do not change the response shape of any successful booking create.**
> - **If you find a scope conflict, stop and ask Hermes PM before changing scope.**
>
> ### Reporting back
> - When the PR is ready for review, post a summary with: the diffstat, the new test count, the live-exercise output (paste the run), and any deviations from this prompt.

---

## 2. The handoff checklist for Hermes Coding

Before you start coding, verify these:

- [ ] You are on `master` at commit `2819c12` (or later; the M0-005a branch starts from here).
- [ ] You have read `docs/M0_REVIEW_PLAN_000_005.md` §4 (backend read model), §6 (slot behavior), §7 (API endpoints), §8 (tests), §9 (must-not-include), §10 (risks).
- [ ] You have read `docs/M0_REVIEW_000_003b.md` §3 (the N2/N3 follow-ups you are closing).
- [ ] You have run `cd service-agent && npm test` and seen **140 passed** locally.
- [ ] You have not modified `service-agent/migrations/**`.
- [ ] You have not modified `landing-page/**`.
- [ ] You have not modified `service-agent/public/**` (the dashboard SPA is M0-005b's territory).

While coding, keep these in mind:

- [ ] Every query uses `db.prepare` with bound parameters. **No raw SQL string interpolation.**
- [ ] The new admin routes are mounted **after** the legacy admin routes in `server.js` (or in a clearly separated `routes/admin.js` module) so reviewers can see the boundary.
- [ ] The `formatBookingForAdmin` function is **pure** (no side effects, no DB writes) so it's testable.
- [ ] The reschedule endpoint runs in a `db.transaction(...)`.
- [ ] The malformed-date branch in `assertNoSlotConflict` runs **before** the past-time check (NaN is not a number; if `getTime()` is NaN, do not compare to `Date.now()`).
- [ ] The overlap query excludes `CANCELLED_*` and `ABANDONED` statuses.
- [ ] The `CLEANER` role gets 403 on every new admin endpoint. Add a test.

Before opening the PR, verify these:

- [ ] `cd service-agent && npm test` → **153 passed**.
- [ ] `cd service-agent && npm run lint` → clean.
- [ ] `cd service-agent && npm run typecheck` → clean.
- [ ] Live exercise output pasted into the PR description: list, detail, calendar, reschedule (past), reschedule (conflict), reschedule (malformed), RBAC (CLEANER 403).
- [ ] No `git grep` hits for `META_(ACCESS|PHONE)_TOKEN` (the M0-002b gate).
- [ ] `git diff --stat` against `master` shows changes only in the files listed in the prompt (§1).
- [ ] `docs/M0_STATUS.md` and `docs/AGENT_HANDOFF.md` are updated.

---

## 3. What Hermes PM is doing in parallel

- Reviewing the M0-005a PR as it lands.
- Holding the line on scope: M0-005a is backend-only. No dashboard, no landing, no schema.
- On standby for any scope conflict that comes up.
- Will flip M0-005a to DONE in the queue and hand the next handoff to MiniMax for M0-005b.
- Will not start M0-005c, M0-006, or M0-007 until M0-005b merges.

---

## 4. What is out of scope (the "do not do" list, copy-pasted from the plan)

1. Schema changes (no new tables, columns, triggers, indexes via migration).
2. Payment approval / verify / reject UI (M0-006).
3. Cleaner assignment UI (M0-007).
4. Drag-to-reschedule / drag-to-assign on the calendar (M0-005b polish at earliest).
5. New Socket.io events (M0-007).
6. Removing legacy `/api/bookings` or `/api/calendar` routes (M0-005b deprecation).
7. A real InstaPay API integration.
8. Multi-tenant / multi-business.
9. Social media / marketing / Postiz / TikTok.
10. shadcn/ui migration (future refactor).
11. The public landing form (M0-004).
12. The AI orchestrator.
13. Adding a `bookings_v2` index via this PR (M0-005b if needed).
14. Renaming `bookings_v2` to `bookings` (M1).

---

## 5. Risks you should know about

- **R3:** `missingFields` is parsed from `bookings_v2.notes` (a fragile string-format shim from M0-003). M0-005b adds a dedicated `missing_fields TEXT` column. M0-005a documents the shim in a code comment near `formatBookingForAdmin`. Add a test that asserts the parse works.
- **R4:** verify `requireRole` middleware exists. If not, add a 1-line wrapper in `service-agent/auth.js` (or wherever the existing `requireAuth` lives). CLEANER JWT must get 403 on the new admin endpoints.
- **R5:** the 6 pre-existing high audit findings in `service-agent` (Mastra → socket.io → engine.io → ws) keep the M0-002b audit gate red. **M0-005a is independent**; M0-002c is the ticket. M0-005a's new code is pure read; it does not introduce new vulns.
- **R7:** the dashboard's "Right now" and "Up next" blocks will be empty in M0-005a/M0-005b because those statuses don't exist. **This is correct.** M0-007 fills them in.
- **R8:** reschedule race conditions. Two concurrent reschedules could both pass the overlap check; the DB transaction serializes the loser. **Add a test** that asserts one wins, the other gets 409.
- **R9:** timezone correctness. The admin API must return ISO-8601 with offset (`...+02:00`); the dashboard will format in `Africa/Cairo` at render time. Do not format in the API.

---

## 6. The exact commit shape we expect

```
M0-005a (1 PR, or 2 if you split backend/test):

  commit 1: feat(admin): add v2 booking read model + reschedule route
    - service-agent/services/admin-bookings-read.js (new)
    - service-agent/services/slot-overlap.js (new)
    - service-agent/routes/admin.js (4 new routes)
    - service-agent/server.js (mount)
    - service-agent/database.js (helpers only)
    - service-agent/services/public-bookings.js (replace checkSlotConflict)
    - docs/M0_STATUS.md (M0-005a section)
    - docs/AGENT_HANDOFF.md (M0-005a subsection + recommended PRs update)
    - docs/IMPLEMENTATION_QUEUE.md (M0-005a status → DONE; queue updates)

  commit 2 (if split): test(admin): add 13 tests for v2 read model + slot overlap
    - service-agent/tests/admin-bookings-read.test.js (new, 7 tests)
    - service-agent/tests/slot-overlap.test.js (new, 6 tests)
    - service-agent/tests/public-bookings-m0.test.js (extend, 1 test)
```

Either single PR or two-commit PR is fine. Do not split the route additions from the service module.

---

## 7. Handoff acknowledgement

Hermes Coding: when you start, post a one-line reply in the team channel:
> **M0-005a started. Branch: `feature/m0-005a-backend-read-model`. Base: `master@2819c12`. Plan: `docs/M0_REVIEW_PLAN_000_005.md`. Prompt: `docs/M0_005A_HANDOFF.md` §1.**

When you open the PR, post:
> **M0-005a PR ready for review. Tests: 140 → 153. Live exercise: pasted in PR body. Diffstat: `<paste>`.**

If you hit a scope conflict, stop and post:
> **M0-005a blocker: `<describe>`. Asking Hermes PM before proceeding.**

---

*End of handoff.*
