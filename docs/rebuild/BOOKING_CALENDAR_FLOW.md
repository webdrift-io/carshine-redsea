# Booking + Calendar Flow

> Status: **DRAFT v1.0** • Owner: Coding Engineer (with AI/Agent agent and Integrations agent)
> One end-to-end story of how a booking enters the system, lives in the calendar, and moves through its lifecycle.

---

## 1. The end-to-end swimlane

```
                    ┌─────────────┐
                    │  Customer   │
                    └──────┬──────┘
                           │ 1. message
                           ▼
        ┌────────────────────────────────────┐
        │  Channel: Web form | Chatbot |     │
        │  WhatsApp | Email                  │
        └──────┬─────────────────────────────┘
               │ 2. inbound event
               ▼
        ┌────────────────────────────────────┐
        │  /api/public/{bookings|chat|inbound}│  ←─ all 4 channels
        └──────┬─────────────────────────────┘
               │ 3. normalize → chat_session
               ▼
        ┌────────────────────────────────────┐
        │  Orchestrator                      │
        │  ├─ router (deterministic)         │
        │  ├─ intake (collect fields)        │
        │  ├─ booking (slot + create)        │
        │  └─ handoff (escalate)             │
        └──────┬─────────────────────────────┘
               │ 4. tool calls (slot_check, customer_upsert,
               │    vehicle_upsert, booking_create)
               ▼
        ┌────────────────────────────────────┐
        │  SQLite: bookings + customers +    │
        │  vehicles + booking_status_history │
        └──────┬─────────────────────────────┘
               │ 5. broadcast booking:created (Socket.io)
               ▼
        ┌────────────────────────────────────┐
        │  Dashboard "Today" + Calendar      │
        │  (owner sees it immediately)        │
        └────────────────────────────────────┘
```

## 2. Field collection (the "intake" state machine)

The booking can be in `INTAKE_INCOMPLETE` until **all required fields** are present. Required:

| Field | How it's collected | Example |
|---|---|---|
| `customerName` | First turn or form field | "My name is Ahmed" |
| `phone` | Required; WhatsApp customers get it for free | "+201234567890" |
| `serviceId` | Menu question or form dropdown | "EXTERIOR_SEDAN" |
| `carType` | Followed by make/model/color (optional) | "Sedan, white Toyota Corolla" |
| `address` | Free text + area auto-detected | "Marina Plaza, El Gouna" |
| `scheduledStart` | "Tomorrow 10am" → parsed to ISO | "2026-06-16T10:00:00+02:00" |

The intake agent asks for **one missing field at a time** in the customer's language. Egyptian Arabic is colloquial, not Fusha. Confirms with a short summary before calling `slot_check`.

**Intake completeness check (deterministic):**
```js
function isIntakeComplete(b) {
  return b.customerName && b.phone && b.serviceId && b.scheduledStart;
}
```

If complete → move to `PENDING_CONFIRMATION` and ask the customer to confirm ("تمام يا باشا، بكرة الساعة 10 الصبح في Marina Plaza، sedan exterior wash بـ 350 جنيه، تأكيد؟"). If yes → `CONFIRMED` and call `slot_check` → `booking_create`. If no → ask what to change.

## 3. Slot validation algorithm

`slot_check` (in `agents/tools.js`) does the following, in a single transaction:

1. Parse `scheduledStart` → `{ date, hour, minute }` in `Africa/Cairo`.
2. Reject if `holiday_check(date).closed` → return `OUTSIDE_HOURS / HOLIDAY`.
3. Reject if hour is not in `[09, 17)` → `OUTSIDE_HOURS`.
4. Reject if `scheduledStart < now` → `PAST`.
5. Compute `scheduledEnd = scheduledStart + service.duration_minutes`.
6. Compute `service_window = [scheduledStart, scheduledEnd]`.
7. Count active cleaners on shift that hour: `SELECT COUNT(*) FROM users WHERE role='CLEANER' AND active=1 AND shift_start <= 'HH:00' AND shift_end > 'HH:00' AND deleted_at IS NULL`. `capacity = min(2, count)`.
8. Count bookings whose `[scheduledStart, scheduledEnd]` overlaps `service_window` and `status NOT IN ('CANCELLED_*','ABANDONED','NO_SHOW')`: `taken`.
9. If `taken < capacity` → `available: true`.
10. Else → `available: false, suggested_slots: [3 nearest hours in next 48h with capacity]`.

**Conflict prevention, not just slot counting:** the same query that checks capacity also checks the **specific cleaner's schedule** if `preferred_staff_id` is provided. So if Mahmoud is busy 10:00–11:30, assigning him another booking at 10:30 fails with `STAFF_BUSY`.

## 4. Booking lifecycle (the state machine)

```
                          ┌─────────────────────────────┐
                          │ INTAKE_INCOMPLETE           │
                          │ (no row in bookings yet,    │
                          │  only chat_session + leads) │
                          └────────────┬────────────────┘
                                       │ intake complete
                                       ▼
                          ┌─────────────────────────────┐
                          │ PENDING_CONFIRMATION        │
                          └────────────┬────────────────┘
                                       │ customer confirms
                                       ▼
                          ┌─────────────────────────────┐
                          │ CONFIRMED                   │
                          └────────────┬────────────────┘
                                       │ payment submitted
                                       ▼
                          ┌─────────────────────────────┐
                          │ PAYMENT_PENDING_REVIEW      │
                          └────────┬───────────────┬─────┘
                          verify  │               │  reject
                                  ▼               ▼
                          ┌─────────────┐  ┌─────────────┐
                          │ PAID        │  │ UNPAID      │
                          └──────┬──────┘  └─────────────┘
                                 │ assign_staff
                                 ▼
                          ┌─────────────────────────────┐
                          │ ASSIGNED                    │
                          └────────────┬────────────────┘
                                       │ cleaner marks EN_ROUTE
                                       ▼
                          ┌─────────────────────────────┐
                          │ EN_ROUTE                    │
                          └────────────┬────────────────┘
                                       │ cleaner marks ON_SITE
                                       ▼
                          ┌─────────────────────────────┐
                          │ ON_SITE                     │
                          └────────────┬────────────────┘
                                       │ cleaner marks IN_PROGRESS
                                       ▼
                          ┌─────────────────────────────┐
                          │ IN_PROGRESS                 │
                          └────────────┬────────────────┘
                                       │ cleaner marks COMPLETED
                                       ▼
                          ┌─────────────────────────────┐
                          │ COMPLETED                   │
                          └─────────────────────────────┘

       Side states: CANCELLED_BY_CUSTOMER, CANCELLED_BY_OWNER, NO_SHOW, ABANDONED
```

### 4.1 Who can transition whom

| Transition | AI | Owner | Cleaner | Customer (self) |
|---|:-:|:-:|:-:|:-:|
| INTAKE_INCOMPLETE → PENDING_CONFIRMATION | ✅ | ✅ | ❌ | ✅ (via chat) |
| PENDING_CONFIRMATION → CONFIRMED | ✅ | ✅ | ❌ | ✅ |
| CONFIRMED → PAYMENT_PENDING_REVIEW | ✅ (on submit) | ✅ | ❌ | ✅ (via WhatsApp/email) |
| PAYMENT_PENDING_REVIEW → PAID | ❌ | ✅ | ❌ | ❌ |
| PAYMENT_PENDING_REVIEW → UNPAID | ❌ | ✅ | ❌ | ❌ |
| CONFIRMED / PAID → ASSIGNED | ❌ | ✅ | ❌ | ❌ |
| ASSIGNED → EN_ROUTE | ❌ | ✅ | ✅ (own) | ❌ |
| EN_ROUTE → ON_SITE | ❌ | ✅ | ✅ (own) | ❌ |
| ON_SITE → IN_PROGRESS | ❌ | ✅ | ✅ (own) | ❌ |
| IN_PROGRESS → COMPLETED | ❌ | ✅ | ✅ (own) | ❌ |
| Any → CANCELLED_BY_* | ⚠️ (proposes only) | ✅ | ❌ | ✅ (with reason) |
| CONFIRMED+ → NO_SHOW | ❌ | ✅ | ✅ (own) | ❌ |
| INTAKE_INCOMPLETE (2 days stale) → ABANDONED | ✅ (system job) | ❌ | ❌ | ❌ |

Every transition writes a `booking_status_history` row. Every transition emits a Socket.io `booking:updated` event. Transitions out of `COMPLETED` are **not allowed** except by an admin override that also writes to `booking_status_history.reason = 'override-by-owner'`.

### 4.2 What the customer sees at each step (messages)

| Status | Auto-message (channel of first contact) |
|---|---|
| CONFIRMED | `BOOKING_CONFIRMED` — "تمام يا باشا، تم تأكيد الحجز. بكرة الساعة 10. هنبعتلك رسالة الدفع." |
| PAYMENT_PENDING_REVIEW | `PAYMENT_INSTRUCTIONS` — "ابعت الـ 350 جنيه على InstaPay للرقم 010… وابعتلنا سكرين شوت." |
| PAID | `PAYMENT_VERIFIED` — "تم استلام المبلغ، نشوفك بكرة 10." |
| ASSIGNED | `CLEANER_ASSIGNED` — "المغسلة Mahmoud هي اللي هتيجي. هيتواصل معاك قبلها بنص ساعة." |
| EN_ROUTE | `CLEANER_EN_ROUTE` — "Mahmoud في الطريق، يوصل خلال 15 دقيقة." |
| ON_SITE | `CLEANER_ARRIVED` — "Mahmoud وصل." |
| COMPLETED | `JOB_COMPLETED` + `REVIEW_REQUEST` (after 30 min) |
| CANCELLED | `BOOKING_CANCELLED` with reason |

All templates live in `service-agent/messages/templates.{en,ar,de}.json`. The customer's `language` from the booking picks the variant.

## 5. Reminder job

A daily cron at 09:00 and 14:00 `Africa/Cairo` runs:

```sql
SELECT b.* FROM bookings b
WHERE b.scheduled_start BETWEEN datetime('now', 'start of day', '+1 day') AND datetime('now', 'start of day', '+2 day')
  AND b.status IN ('CONFIRMED', 'PAID', 'ASSIGNED')
  AND NOT EXISTS (
    SELECT 1 FROM messages m
    WHERE m.booking_id = b.id
      AND m.template_code = 'REMINDER_24H'
  );
```

For each result, send `REMINDER_24H` to the customer's preferred channel. Idempotent.

## 6. Calendar view — what the owner actually sees

The calendar is a **read model** over `bookings + assignments + users`. It is **not** a separate `calendar_events` table. The old `calendar_events` table is read-only in M0 (fallback for any pre-rebuild data), then dropped in M1.

**Render rules:**
- Group bookings by `scheduled_start` rounded to the hour.
- For each hour cell, show up to `capacity` (visual cap). If bookings > capacity, show "+N more" and a click-to-expand.
- Color per status (see `DASHBOARD_PLAN.md` §2.2).
- Holiday days are gray with a small badge.

**Drag-to-reschedule:**
- Owner-only.
- Drop calls `booking_reschedule({ booking_id, new_scheduled_start })`.
- Tool re-runs `slot_check`; if the new slot is full, the move is rejected with a toast: "الساعة دي ممتلئة."
- On success, the booking card animates to the new position.

## 7. No-show + late cancel policy

- If cleaner marks `NO_SHOW` and `payment_status = PAID`, the system auto-creates a refund request (M1) and a `REVIEW_REQUEST` with a different copy.
- Customer cancel < 24h before scheduled_start → owner must approve. Owner cancel < 24h → mandatory reason; the message to the customer is in their language.

## 8. Idempotency

Every inbound channel can produce duplicates (WhatsApp retries, email IMAP polling, form double-clicks). The contract:

- Inbound messages get an `idempotency_key` (provider message id, or a hash of `customer_id + body + 60s_bucket` for web form).
- `chat_messages` has `UNIQUE(provider, provider_message_id)`. Duplicates are silently dropped.
- `booking_create` is idempotent on `(customer_id, scheduled_start, service_id, source='WEB_FORM')` within a 5-minute window — if a duplicate POST lands, it returns the existing booking's `public_ref`.

## 9. Acceptance criteria for the booking + calendar flow

- A simulated customer creates a booking via the web form. The booking appears in the dashboard Today view and the Calendar day view in < 2 seconds. ✅
- The customer sees the `BOOKING_CONFIRMED` message on the channel they used within 5 seconds. ✅
- A second POST to the form with the same idempotency key returns the same `public_ref` and does not create a new booking. ✅
- A `slot_check` for a past time returns `available: false, reason: 'PAST'`. ✅
- A `slot_check` for a holiday returns `OUTSIDE_HOURS / HOLIDAY`. ✅
- A `slot_check` for a full hour returns `available: false` with 3 suggested slots, all in working hours, all with capacity. ✅
- Drag-reschedule to a full hour is rejected. ✅
- The cleaner view shows the assigned booking within 5 seconds of `assign_staff`. ✅
- An `INTAKE_INCOMPLETE` booking older than 48 hours is moved to `ABANDONED` by the nightly job. ✅
- A `COMPLETED` booking cannot be moved to `CANCELLED_*` without an admin override. ✅

## 10. Open questions

| # | Question | Owner | Due |
|---|---|---|---|
| Q1 | Buffer time between bookings for the same cleaner (e.g. 15 min travel)? | Product + Coding Engineer | Day 4 |
| Q2 | "Soft hold" — when a customer is mid-checkout, do we reserve the slot for 5 minutes? | Coding Engineer | Day 5 |
| Q3 | If 2 cleaners are on shift but both busy, do we suggest slots 30 min earlier/later, or only same day? | Product | Day 4 |
| Q4 | Do we offer "instant book" with no payment pre-auth, or require payment before confirmation? | Product (business call) | Day 2 |
