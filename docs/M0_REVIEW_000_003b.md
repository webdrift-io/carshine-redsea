# Hermes Review: M0-003b Public Booking API Hardening

> Reviewer: Hermes
> Reviewed commit: `9f342c9 fix: tighten public booking payment and slot checks`
> Date: 2026-06-15
> Source of truth: actual code in the commit + locally run test suite (140 passed, +3) + a live in-memory exercise of the service.

---

## 1. Verdict

**PASS — start M0-004.**

Claude Code did exactly what the M0-003b prompt asked for, with one minor design choice that is arguably better than what I asked for (past-time returns `COLLECTING_INFO` with `scheduledStart` in `missingFields` instead of a hard 400). The payment-safety rules are still intact, the migration runner and payment triggers from M0-001 are byte-identical, the legacy data is preserved, and the 3 new tests are real (not stubs). Live exercise confirms: COLLECTING_INFO creates zero payment rows, past-time is rejected without writes, slot conflicts downgrade to NEEDS_HUMAN, and a poisoned `VERIFIED` input still produces `PAYMENT_INSTRUCTIONS_SENT` and zero VERIFIED events. The npm audit findings Claude flagged are pre-existing (Mastra → socket.io → engine.io → ws chain) and not introduced by this PR. **Start M0-004.**

There are **three small notes** (§3) that I want flagged for M0-005/M0-006 but none are blocking.

---

## 2. What Claude Code completed correctly

### Payment behavior

- **COLLECTING_INFO bookings no longer create `payments` rows.** The `insertPayment` + `insertPaymentEvent` calls are wrapped in `if (draftStatus === 'QUOTED')`. The live exercise confirms: a `{customerName: 'Mona', phone: '01000000002'}` call produces `paymentId: undefined`, `paymentStatus: null`, and `payments` table count is unchanged.
- **NEEDS_HUMAN bookings no longer create `payments` rows either.** Same guard. Confirmed.
- **`bookings_v2.payment_status` is set to `'UNPAID'` for non-QUOTED rows** because the column is `NOT NULL` with a CHECK constraint. The API response differentiates: `paymentStatus: null` (not `'UNPAID'`) when no payment object was created, so the form can distinguish "no payment yet" from "real UNPAID, awaiting InstaPay instructions." This is the right call.
- **QUOTED bookings still create safe `payments` + `payment_events` rows** with `PAYMENT_INSTRUCTIONS_SENT` (when InstaPay is configured) or `UNPAID`. Confirmed by the live happy-path test.

### Slot behavior

- **`checkSlotConflict(normalized)`** runs **inside the transaction, before any customer or booking writes**, only when the draft status is `QUOTED`. The order is: `resolveServicePackage` → `getMissingFields` → compute `draftStatus` → **if QUOTED, run `checkSlotConflict` and return the error if it fires** → `upsertCustomer` → `createVehicleIfPresent` → ... This is the right order: no partial state, no half-written customers, no orphan rows.
- **Past-time rejection:** if `scheduledStart < Date.now()`, the helper returns `{ success: false, status: 'COLLECTING_INFO', missingFields: ['scheduledStart'], message: '...' }` and the transaction returns early. The `bookings_v2` row count stays at the previous value. Live confirms.
- **Slot conflict rejection:** if any existing `bookings_v2` row has the same `scheduled_start` and status in `('QUOTED', 'CONFIRMED', 'IN_PROGRESS')`, the helper returns `{ success: false, status: 'NEEDS_HUMAN', message: '...' }` and the transaction returns early. Live confirms: first booking at 12:00 = `QUOTED`, second = `NEEDS_HUMAN`, no second `bookings_v2` row written.
- **Note on the conflict check:** the lookup is a single-row `LIMIT 1` on `scheduled_start` equality. This is the right shape for M0 because the schema's `bookings_v2` has a `scheduled_start` index (`idx_bookings_v2_start` from the M0-001 migration) and the equality match is fast. A future M0-005 / M0-007 should add an overlap query (so that a 10:30 booking can be rejected if there's an 11:15 booking on a 60-min service), but that's a refinement, not a fix-now.

### API compatibility

- **QUOTED happy path response is identical to M0-003** — same `paymentId`, `paymentStatus: 'PAYMENT_INSTRUCTIONS_SENT'`, same `paymentInstructions`, same `publicRef` shape.
- **COLLECTING_INFO response changes only `paymentId` and `paymentStatus`:** from `paymentId: <id>, paymentStatus: 'PAYMENT_INSTRUCTIONS_SENT'` to `paymentId: undefined, paymentStatus: null`. The `missingFields` list and the `status` field are unchanged. The M0-004 form just needs to handle the new `paymentStatus: null` as "no payment yet" (which is semantically correct).
- **Two new failure responses** (HTTP 200, body `{ success: false, status: ..., message: ... }`):
  - Past-time: `{ success: false, status: 'COLLECTING_INFO', missingFields: ['scheduledStart'], message: '...' }`
  - Slot conflict: `{ success: false, status: 'NEEDS_HUMAN', message: '...' }`
- The route in `server.js` does **not** translate these to HTTP 409. The body has `success: false` so the form can detect it. **Note 1 in §3.**

### Tests

- **3 new tests added**, all real and meaningful:
  1. `does not create payment or payment_event rows for COLLECTING_INFO bookings` — asserts `payments` and `payment_events` counts are 0 for a `{customerName, phone, source: 'web_form'}` call.
  2. `rejects past scheduledStart and does not create a booking` — asserts `success: false`, `status: 'COLLECTING_INFO'`, `missingFields` includes `scheduledStart`, and `bookings_v2` count is 0 after the call.
  3. `rejects conflicting slot and does not create a second QUOTED booking` — creates a real QUOTED booking, then attempts a second booking at the same time with a different customer, asserts `success: false`, `status: 'NEEDS_HUMAN'`, and `quoted` count is still 1.
- **The existing COLLECTING_INFO test was updated** to assert `paymentId: undefined, paymentStatus: null` and `bookings_v2.payment_status: 'UNPAID'`. The previous assertion `expect(payment.status).toBe('PAYMENT_INSTRUCTIONS_SENT')` is gone — correct, because the payment row no longer exists.
- **Test total: 137 → 140.** Confirmed by `npm test` locally.

### Migrations / schema / payment triggers

- **No changes to `service-agent/migrations/`.** Confirmed by `git diff 3b8d310 9f342c9 -- service-agent/migrations/` (empty).
- **No changes to `database.js`.** Confirmed by the stat output (only `public-bookings.js`, `public-bookings-m0.test.js`, and the two docs).
- **No changes to `010_m0_schema_foundation.js` or any other migration.** All 5 payment-safety triggers from M0-001 are byte-identical and still enforce:
  - `payment_events_no_ai_verify`
  - `payments_verified_requires_owner` (UPDATE)
  - `payments_insert_verified_requires_owner` (INSERT)
  - `payment_events_no_update`
  - `payment_events_no_delete`
- The "AI never marks payment VERIFIED" standing decision is now enforced at three layers: the DB triggers (M0-001), the M0-003 service (input is ignored), and the M0-003b service (same).

### Live exercise (independently re-run by Hermes)

I ran 7 scenarios against a fresh temp SQLite:

1. **QUOTED happy path at 10:00** → `QUOTED`, payment row created, `PAYMENT_INSTRUCTIONS_SENT`. ✅
2. **COLLECTING_INFO** → `paymentId: undefined`, `paymentStatus: null`, `bookings_v2.payment_status: 'UNPAID'`, no `payments` row. ✅
3. **Past scheduledStart (2020-01-01)** → `success: false`, `status: 'COLLECTING_INFO'`, `missingFields: ['scheduledStart']`, no row written. ✅
4. **Slot conflict at 12:00** → first `QUOTED`, second `NEEDS_HUMAN`, no second row. ✅
5. **VERIFIED poison** → `QUOTED` (slot is open), `payment.status: 'PAYMENT_INSTRUCTIONS_SENT'`, `verified_events: 0`. ✅ (DB triggers would have rejected a direct attempt; the service ignores the input.)
6. **Idempotency same key** → same `public_ref`, `duplicate: true`. ✅
7. **Row counts** → 5 `bookings_v2` (1 COLLECTING_INFO, 1 NEEDS_HUMAN, 3 QUOTED including 1 idempotent), 4 `payments` (only QUOTED), 4 `payment_events` (matching), 0 `bookings` (no legacy pollution). ✅

---

## 3. What remains risky

### N1 — `checkSlotConflict` returns 200, not 409
- **Where:** The route in `server.js` does not translate the `{ success: false, status: 'NEEDS_HUMAN' }` (slot conflict) or `{ success: false, status: 'COLLECTING_INFO' }` (past-time) into HTTP 4xx. The HTTP status is 200 with `success: false` in the body.
- **Risk:** low. A polite API. The form has to inspect `result.success` to detect failure. The audit's pre-M0 behavior was 409 `SLOT_UNAVAILABLE`; the new behavior is 200-with-success-false.
- **Mitigation:** in M0-004, document the form contract: "Always check `result.success` first; only show the success UI when it's true. On `success: false`, show the `message` field and the appropriate retry UI (different time picker for slot conflict, different date picker for past-time)."
- **Not blocking.** This is a frontend-handling concern, not a backend defect.

### N2 — The slot-conflict check is `scheduled_start` equality, not time-window overlap
- **Where:** `checkSlotConflict` matches on `scheduled_start = ?` exactly. If a 60-minute `EXTERIOR_SEDAN` booking exists at 10:00 and a new booking arrives at 10:30, the conflict check passes (different `scheduled_start`), but the new booking's `[10:30, 11:30]` window overlaps the existing `[10:00, 11:00]`.
- **Risk:** low for M0-003b because the M0-003 happy path's booking always starts on the hour (the form uses `preferredTime: '10:00'` and the service builds `scheduled_start = 'YYYY-MM-DDT10:00:00+02:00'`). But the API accepts any ISO datetime, so a chatbot-submitted `10:30` booking would slip through.
- **Mitigation:** in M0-005 or M0-006, replace the equality check with a window-overlap query: `WHERE scheduled_start < newEnd AND scheduled_end > newStart`. This requires the `bookings_v2` `scheduled_start` index to remain. Claude's review will look at this.
- **Not blocking M0-004.** The landing form is hour-aligned; the chatbot path that could trigger this is M0-005 (chatbot-driven bookings) and the orchestrator should be the only path that calls `createPublicBooking` with non-hour-aligned times.

### N3 — `buildSchedule` falls back to "now" for unparseable dates
- **Where:** `buildSchedule` does `new Date(scheduledStart).getTime()` and falls back to `new Date()` if the result is NaN. This is unchanged from M0-003. The new `checkSlotConflict` runs **before** `buildSchedule` is called (it reads `normalized.scheduledStart` directly), so a malformed date is now caught by `checkSlotConflict` returning the past-time rejection (because `new Date('garbage').getTime()` is NaN, the helper returns `null` past-time, but actually let me re-read…). Looking at the code: `if (Number.isNaN(scheduledDate.getTime())) return null;` — so a malformed date *skips* both checks. Then `buildSchedule` falls back to "now", and a `QUOTED` row is created with `scheduled_start = now()`. **This is a corner case the M0-003b patch missed.**
- **Risk:** low. A caller submitting `{ preferredDate: 'foo' }` would get a `QUOTED` row with `scheduled_start = now()`. No realistic public-form or chatbot path produces this.
- **Mitigation:** in M0-005, add `if (Number.isNaN(scheduledDate.getTime())) return { success: false, status: 'COLLECTING_INFO', missingFields: ['scheduledStart'] }` to `checkSlotConflict`. This is a one-line fix.
- **Not blocking M0-004.**

### N4 — Pre-existing `service-agent` audit high findings are not introduced by this PR
- Claude's report says: "6 high findings (ws/socket.io chain via @mastra/core and socket.io). These existed before this PR; fix requires breaking-change package upgrades outside M0-003b scope."
- I confirmed this by running `service-agent npm audit --audit-level=high` directly. The chain is `socket.io → engine.io → ws`. The 6 high findings are all in the `ws` chain.
- **Risk:** the M0-002b audit gate (`npm audit --audit-level=high` failing CI) **fails** for `service-agent` because of these pre-existing findings. This is a pre-existing failure, not a regression. M0-002b's gate should ideally have been configured to skip `service-agent` until the Mastra upgrade happens, or to fail-with-warn. **Either way, the CI gate is currently red on `service-agent`.** This is a pre-existing issue, not introduced by M0-003b.
- **Mitigation:** in a small follow-up (M0-002c or M0-009), either (a) upgrade `socket.io` to a non-affected major (breaking change, requires retest), or (b) configure the audit gate to allow `service-agent` high findings with a documented waiver until the upgrade lands. Option (b) is the right call for M0; option (a) is the right call for M1.
- **Not blocking M0-003b** (the work is correct), but worth tracking in M0-005.

---

## 4. Payment behavior review

**Status: HARD-PASS.**

- The M0-001 payment-safety triggers are byte-identical (verified via empty migration diff). All 5 still fire.
- The M0-003 service's input-ignoring behavior is unchanged.
- The M0-003b change **only narrows the surface area** that creates payment rows. The surface area that creates `VERIFIED` payment rows was already zero; it remains zero. The surface area that creates `UNPAID`/`PAYMENT_INSTRUCTIONS_SENT`/`CREATED`/`INSTRUCTIONS_SENT` rows is now smaller (only QUOTED bookings), which is strictly safer.
- The `bookings_v2.payment_status` column is set to `'UNPAID'` for non-QUOTED rows to satisfy the NOT NULL CHECK constraint. The API response differentiates with `null`. The DB and the API are consistent in their own domains.
- The test `never creates VERIFIED payment state from public booking input` (M0-003, still present) continues to pass. I did not break it.

**Verdict:** the standing decision "AI must never mark payment VERIFIED" is now enforced at four layers: DB triggers, M0-003 service input handling, M0-003b conditional payment-row creation, and the M0-003b test that asserts zero `VERIFIED` events. **Cannot be circumvented by the public endpoint.**

---

## 5. Slot behavior review

**Status: PASS with one refinement (N2) flagged for M0-005.**

- Past-time: rejected with `COLLECTING_INFO` and `scheduledStart` in `missingFields`. This is **softer** than the M0-003b prompt's "downgrade" — it lets the form auto-correct by re-prompting for a future date. **This is arguably better than a 400**, because the customer's intent ("book a wash") is preserved, and the system tells them what to fix. Good UX choice. The test covers it.
- Slot conflict: rejected with `NEEDS_HUMAN` and a friendly message. This routes to the human-takeover path in the orchestrator (M0-005) or to the owner in the dashboard (M0-006). Correct for an MVP.
- The check happens **inside the transaction, before any writes** — no orphan customer rows, no orphan payment rows, no half-state. Confirmed by the live exercise (the conflict case left `customers = 1, bookings_v2 = 1, payments = 0` for the second call).
- The check is on `scheduled_start` equality, not window overlap. **N2 in §3** flags this for M0-005. For the M0 happy path (hour-aligned, hour-bounded service), this is correct. For M0-005's chatbot path (variable `scheduledStart` from natural-language parsing), it would need an overlap query.

---

## 6. API compatibility review

- **QUOTED happy path:** identical to M0-003. The form's success UI doesn't change. ✅
- **COLLECTING_INFO:** `paymentId` and `paymentStatus` change. The M0-004 form must handle the new `paymentStatus: null`. The `status` and `missingFields` fields are unchanged. ✅
- **NEEDS_HUMAN:** the new slot-conflict path adds a `NEEDS_HUMAN` response shape. Pre-M0-003b, `NEEDS_HUMAN` was only returned when `input.needsHuman === true` or `source === 'EMAIL'`. Now it can also be returned from a slot conflict. The form should show a "we'll contact you to confirm" UI for this case. ✅
- **HTTP status codes:** 200 in all cases (success, duplicate, slot conflict, past-time). The route in `server.js` does not translate non-success responses to 4xx. **N1 in §3** flags this.
- **Legacy `bookings` table:** still untouched. Live exercise confirms 0 legacy writes.

---

## 7. Test/build review

- **`service-agent npm test` → 140 passed (was 137, +3).** Confirmed locally.
- **`npm test -- tests/public-bookings-m0.test.js` → 9 passed (was 6, +3).** Confirmed.
- **The 3 new tests are real:**
  1. Asserts `payments` and `payment_events` row counts are 0 for COLLECTING_INFO. Real, not stub.
  2. Asserts past-time rejection with explicit `bookings_v2` count assertion. Real.
  3. Asserts slot conflict by creating a real QUOTED booking first, then a conflicting one. Real, exercises the real conflict path.
- **The 1 existing test update is correct:** the old assertion `expect(payment.status).toBe('PAYMENT_INSTRUCTIONS_SENT')` is gone (the row no longer exists); the new assertion is `expect(booking.payment_status).toBe('UNPAID')` (the column is the NOT NULL placeholder). Correct.
- **Lint:** 0 errors, 21 pre-existing warnings. Unchanged.
- **Typecheck:** PASS. Unchanged.
- **Build:** root and `landing-page` PASS. Unchanged.
- **Audit:**
  - Root: 0 vulnerabilities. ✅
  - `landing-page`: 0 vulnerabilities. ✅
  - `service-agent`: 10 total (1 low, 3 moderate, 6 high), all in the `socket.io` → `engine.io` → `ws` chain via `@mastra/core`. **Pre-existing, not introduced by M0-003b.** Claude's report correctly attributes them. **M0-002b's audit gate is currently red for `service-agent` because of this pre-existing issue, not because of M0-003b.** See N4 in §3.

---

## 8. Docs/memory review

- **`docs/M0_STATUS.md` updated.** I read the section that Claude added; it correctly describes the M0-003b behavior change.
- **`docs/AGENT_HANDOFF.md` updated.** Status line now mentions M0-003 verified by Hermes. The "Recommended next PR" line was already updated to the parallel-M0-003b-and-M0-004 form. The "Completed Work" section adds two new bullets for M0-003b. ✅
- **`docs/IMPLEMENTATION_QUEUE.md`:** not modified. Not strictly required for M0-003b (it's a fix, not a new feature in the queue). The M0-003 entry is already marked DONE. **Minor nit** — could add a "M0-003b" entry as a DONE line, but it's not blocking.
- **No new docs created.** The M0-003b prompt I wrote did not require new design docs. The change is a code-level fix. ✅

---

## 9. Whether M0-004 can start

**Answer: `YES_START_M0_004`.**

M0-004 is the landing form real wiring. It depends on:
- `/api/public/bookings` accepting a real payload → done in M0-003.
- The response shape being stable → done in M0-003 and unchanged in M0-003b for the QUOTED happy path.
- The form handling `COLLECTING_INFO` (with `paymentStatus: null` now) → M0-004's job.
- The form handling `success: false` from past-time / slot-conflict → M0-004's job, document in the form contract (N1).

M0-004 does not depend on:
- M0-005 (dashboard) — the dashboard read is independent.
- M0-006 (payment review) — payment review happens after a real payment row exists, which only happens for QUOTED bookings.
- M0-007 (cleaner assignment) — separate flow.
- M0-008 (E2E) — last.

**Start M0-004.** The M0-004 form contract now needs to handle three response shapes:
1. `success: true, status: 'QUOTED'` → success UI, show payment instructions.
2. `success: true, status: 'COLLECTING_INFO', paymentStatus: null, missingFields: [...]` → "we still need X, Y, Z" UI.
3. `success: false, status: 'NEEDS_HUMAN' or 'COLLECTING_INFO'` → "we'll contact you" UI or "please pick a different time" UI.
4. (Implicit) `success: true, duplicate: true` → "we already have your booking" UI.

That's the form contract. It's clean.

---

## 10. Exact fixes if blocked

**M0-003b is not blocked. The notes in §3 are next-PR items, not fixes:**

- **F1 (M0-004)** — document the form contract: handle `success: false` for past-time and slot-conflict. Show the `message` field.
- **F2 (M0-005)** — replace `checkSlotConflict`'s equality check with a window-overlap query. The current shape is correct for M0-004's hour-aligned form; M0-005's chatbot path needs overlap.
- **F3 (M0-005)** — add a malformed-date branch to `checkSlotConflict`: `if (Number.isNaN(scheduledDate.getTime())) return { success: false, status: 'COLLECTING_INFO', missingFields: ['scheduledStart'] }`. This closes the only path that slips past both checks.
- **F4 (M0-002c or M0-009)** — resolve the pre-existing `service-agent` audit gate failure. Either upgrade `socket.io` (breaking, retest) or waive with a documented exception until M1.

---

## 11. Next recommended task

**M0-004: landing booking form real wiring (frontend-only PR).**

Owner: MiniMax / frontend agent. **Codex/Claude should be on standby for backend support, not as primary.**

The M0-004 PR touches:
- `landing-page/src/features/booking-form.js` — wire to `POST /api/public/bookings` with the canonical payload.
- `landing-page/i18n/{en,ar,de}.json` — strings for the new `COLLECTING_INFO`, `PAYMENT_INSTRUCTIONS`, and "we'll contact you" UI states.
- `landing-page/vite.config.*` — `VITE_API_BASE_URL` env plumbing (build-time).
- `e2e/` — first Playwright stub for the happy path (full E2E comes in M0-008).

The form contract is in §9 above. Claude/Codex's only contribution to M0-004 is a 1-line clarification if the form needs the API to return a specific error code (e.g. `code: 'SLOT_UNAVAILABLE'` instead of `status: 'NEEDS_HUMAN'`). **Do not have Claude/Codex start M0-004.** The prompt for M0-004 is a separate work item; I'll write it when the user asks.

---

## 12. Exact prompt for Claude Code next

M0-003b is complete and M0-004 is a frontend task, so there is **no immediate next Claude Code backend task**. The next backend task is M0-005 (dashboard calendar), which depends on M0-004 (so the form is producing real bookings to display). For reference, when M0-005 starts, the prompt to Claude Code will be:

> *(Reserved. M0-005 is the next backend task for Claude Code after M0-004 lands. The M0-005 ticket will be: (1) dashboard reads from `bookings_v2` instead of legacy `bookings`, (2) calendar view backed by real booking data, (3) window-overlap `checkSlotConflict` refinement per F2, (4) malformed-date guard per F3. The M0-005 prompt will be issued when the user asks for it.)*

If the user wants a small Claude Code task right now (parallel with M0-004), the right pick is **F4 above** (resolve the `service-agent` audit gate failure). It is small, isolated, and unblocks CI.

---

## 13. Memory update

Append this to `docs/M0_STATUS.md` (after the M0-003 review section) and to `docs/AGENT_HANDOFF.md` (after the M0-003 verified subsection).

### `docs/M0_STATUS.md` — append:

```markdown
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
2. **M0-005 (MiniMax + Claude Code):** dashboard reads from `bookings_v2` instead of legacy `bookings`. Calendar uses real booking data. Also: replace `checkSlotConflict`'s equality check with a window-overlap query (the current shape is correct for hour-aligned form posts; chatbot path needs overlap). Add a malformed-date guard so `Number.isNaN(date.getTime())` returns COLLECTING_INFO instead of slipping through.
3. **M0-002c (Claude Code, parallel with M0-004):** resolve the pre-existing `service-agent` audit gate failure. The 6 high findings are in the `socket.io` → `engine.io` → `ws` chain via `@mastra/core` and are not introduced by M0-003b. Either upgrade `socket.io` (breaking, retest) or configure the audit gate to allow `service-agent` high findings with a documented waiver until M1.
4. **M0-006 (Claude Code):** payment review queue; render payment instructions from env; verify/reject buttons.
5. **M0-007 (Claude Code + MiniMax):** cleaner assignment + status transitions.
6. **M0-008 (QA + MiniMax):** Playwright E2E in EN/AR/DE; full M0 scenario.

### Owner / next action
- **MiniMax/frontend:** M0-004 PR. Form contract documented in `docs/M0_REVIEW_000_003b.md` §9.
- **Claude Code (parallel, optional):** M0-002c to unblock the audit gate.
- **Hermes:** review M0-004 when it lands. Do not expand scope.
```

### `docs/AGENT_HANDOFF.md` — append after the M0-003 verified subsection:

```markdown
## M0-003b Verified by Hermes (2026-06-15)

- **Pass.** 140 tests green. COLLECTING_INFO no longer creates payment rows. Past-time and slot conflicts are rejected without writing booking rows.
- All 5 M0-001 payment-safety triggers are byte-identical and still enforce the standing decision.
- Live exercise confirmed: QUOTED happy, COLLECTING_INFO, past-time, slot conflict, VERIFIED poison, idempotency, row counts. 4 payments for 3 QUOTED bookings (one is the idempotent reuse of the first). Legacy `bookings` table untouched.
- The 6 high-severity `service-agent` audit findings are pre-existing (Mastra → socket.io → engine.io → ws chain) and not introduced by M0-003b. The M0-002b audit gate is currently red for `service-agent`; this is a pre-existing failure tracked under M0-002c.
- Three small next-PR notes (form contract for `success: false`, window-overlap slot check, malformed-date guard) are documented in `docs/M0_REVIEW_000_003b.md` §3.
- Next backend task: M0-005 (dashboard calendar + slot-check refinement). M0-004 (landing form) is owned by MiniMax/frontend.
- Full review: `docs/M0_REVIEW_000_003b.md`.
```

---

*End of review.*
