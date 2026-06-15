# Payment Flow — Manual InstaPay MVP

> Status: **DRAFT v1.0** • Owner: Integrations agent (with Coding Engineer + Security sign-off)
> No official InstaPay API exists that we can credibly integrate with. This plan is the **safe, honest, manual** path. It can be replaced with a real gateway later by swapping the `payment_verify` tool.

---

## 1. The non-negotiable rules

1. **The system never claims "paid" without `payments.status = VERIFIED`.** Period. No short-circuits, no "the bot said paid," no "the customer said paid."
2. **Every state change to a payment is append-only logged** in `payment_events`.
3. **No card data is ever stored, processed, or transmitted by our backend.** We're not a payment processor. We're a record of one.
4. **Receipts are stored as opaque URLs.** We don't OCR them in M0. A human looks at them in the dashboard.
5. **One payment per booking in M0.** A partial / split payment is M1.
6. **Currency is EGP only in M0.** No multi-currency.
7. **The InstaPay instructions come from configuration, not hardcoded literals** in messages. We can change the receiving number without a deploy.

## 2. Configuration (env-driven, not code-driven)

```
INSTAPAY_RECEIVING_NUMBER=01XXXXXXXXX
INSTAPAY_RECEIVING_NAME="CarShine Red Sea"
INSTAPAY_QR_IMAGE_URL=https://cdn.carshine.example/instapay-qr.png
INSTAPAY_PAYMENT_LINK=https://instapay.example/pay/...
INSTAPAY_INSTRUCTIONS_EXTRA_EN="Please include your booking ref in the transfer note."
INSTAPAY_INSTRUCTIONS_EXTRA_AR="من فضلك اكتب رقم الحجز في خانة الملاحظات."
INSTAPAY_INSTRUCTIONS_EXTRA_DE="Bitte gib deine Buchungsnummer im Verwendungszweck an."
```

In `service-agent/integrations/instapay.js`, a single `getInstructions({ booking, language })` returns the rendered object for any tool. The bot's reply and the email/WhatsApp template both consume the same function.

## 3. The payment state machine

```
                 ┌─────────────┐
                 │   UNPAID    │  (default after booking_create)
                 └──────┬──────┘
                        │ customer (or AI on customer's behalf)
                        │ submits proof via any channel
                        ▼
                 ┌─────────────────────┐
                 │ PENDING_REVIEW      │
                 └──────┬──────────────┘
                        │
              ┌─────────┴─────────┐
              │                   │
       owner verify        owner reject
              │                   │
              ▼                   ▼
        ┌──────────┐         ┌──────────┐
        │ VERIFIED │         │ REJECTED │──┐
        └──────────┘         └──────────┘  │
              │                             │
              │                             │ customer re-submits
              │                             ▼
              │                       (back to PENDING_REVIEW)
                 │
                 ▼
        (booking.payment_status = PAID,
         booking.status can move to ASSIGNED)
```

### 3.1 M0-003 public booking initial payment behavior

`POST /api/public/bookings` always creates one `payments` row for the new normalized booking.

- If `INSTAPAY_RECEIVING_NUMBER` is configured, the initial payment status is `PAYMENT_INSTRUCTIONS_SENT` and a `payment_events` row with `event_type = 'INSTRUCTIONS_SENT'` is appended.
- If InstaPay instructions are not configured, the initial payment status is `UNPAID` and a `payment_events` row with `event_type = 'CREATED'` is appended.
- Public booking input is ignored for verification purposes. It cannot create `payments.status = VERIFIED` or a `payment_events` `VERIFIED` row.
- Manual owner review remains M0-006. M0-003 only creates the honest initial payment record.

Special: `CASH_ON_COMPLETION` (M0 placeholder; M1 full) is set when a cleaner marks a job `COMPLETED` with `payment_method = CASH` and no prior submission. Cleaner is prompted to confirm cash was collected; on confirm, `payments.status` skips to `VERIFIED` with a `payment_events` row marked `actor_type = 'CLEANER'`. The owner can override later.

## 4. The customer journey

### 4.1 Booking confirmed
- Customer receives `BOOKING_CONFIRMED` (no payment ask yet — this is the "we got you" message).
- Booking is `status = CONFIRMED`, `payment_status = UNPAID`.

### 4.2 Payment instructions sent
- Trigger: 30 seconds after CONFIRMED, or immediately if customer asks "how do I pay?" in chat.
- Message: `PAYMENT_INSTRUCTIONS` template, rendered in the customer's language.
  - **EN:** "To confirm your booking, please transfer 350 EGP to InstaPay number 01XXXXXXXXX (CarShine Red Sea). Add your booking ref CR-20260615-001 in the transfer note, then reply with a screenshot or transaction reference. Thank you!"
  - **AR:** "يا فندم، لتأكيد الحجز ابعت 350 جنيه على InstaPay رقم 01XXXXXXXXX باسم CarShine Red Sea، واكتب رقم الحجز CR-20260615-001 في الملاحظات، وبعدين ابعتلنا سكرين شوت أو رقم العملية. شكراً!"
  - **DE:** "Bitte überweise 350 EGP an die InstaPay-Nummer 01XXXXXXXXX (CarShine Red Sea). Gib deine Buchungsnummer CR-20260615-001 als Verwendungszweck an und schick uns einen Screenshot oder die Transaktionsnummer. Danke!"
- If `INSTAPAY_QR_IMAGE_URL` is set, the image is attached (WhatsApp supports inline images).
- Booking is still `status = CONFIRMED`, `payment_status = UNPAID`.

### 4.3 Customer submits proof
Three submission paths, all funneling into the same `payment_record_submission` tool:

**Path A — WhatsApp:** Customer replies with a screenshot OR with text like "I sent it, ref 123456789". The WhatsApp webhook routes through the orchestrator; the orchestrator recognizes the intent and either:
  - Detects an image attachment → uploads to local disk (or S3-compatible) under `receipts/<booking_id>/<timestamp>.<ext>`, sets `screenshot_url`, calls `payment_record_submission({ method: 'INSTAPAY', screenshot_url, reference: undefined })`.
  - Detects a transaction reference (regex) → calls `payment_record_submission({ method: 'INSTAPAY', reference: '...' })`.

**Path B — Email:** Customer replies to the booking email with an attached image or "I sent 350 EGP, ref 123." Same funnel, channel = EMAIL.

**Path C — Web form:** A small "I paid" button on the public status page (`/b/<ref>?t=...`) opens a form: amount, reference, optional screenshot upload (multipart POST).

All three paths produce the same result:
- `payments.status = PENDING_REVIEW`
- `payments.submitted_at = now`
- `bookings.payment_status = PENDING_REVIEW`
- `payment_events` row appended: `event_type = 'SUBMITTED'`
- Auto-message to customer: `PAYMENT_SUBMITTED_ACK` — "استلمنا التحويل، هنتأكد منه ونرجعلك في دقايق."

### 4.4 Owner reviews
- The dashboard's Payments section shows a "Pending review" queue.
- Each row: booking ref, customer, amount, method, submitted time, age (color-coded: < 1h green, 1–6h yellow, > 6h red), reference, screenshot thumbnail.
- Two actions: **Approve** (no reason needed) and **Reject** (reason required, dropdown of canned reasons + free text).
- Canned rejection reasons (per language):
  - "Reference not found in InstaPay"
  - "Amount doesn't match"
  - "Screenshot unreadable"
  - "Duplicate / already verified"
  - "Other — see note"
- On Approve:
  - `payments.status = VERIFIED`, `verified_by = owner.id`, `verified_at = now`
  - `bookings.payment_status = PAID`
  - `payment_events` row: `event_type = 'VERIFIED'`
  - Auto-message to customer: `PAYMENT_VERIFIED` — "تمام يا باشا، اتأكدنا من المبلغ. نشوفك بكرة 10."
  - Socket.io emit: `payment:updated`
- On Reject:
  - `payments.status = REJECTED`, `rejection_reason = ...`
  - `bookings.payment_status = UNPAID`
  - `payment_events` row: `event_type = 'REJECTED'`
  - Auto-message to customer: `PAYMENT_REJECTED` with the reason, plus a re-send of `PAYMENT_INSTRUCTIONS`
  - Socket.io emit: `payment:updated`

### 4.5 The AI never auto-verifies
A test in `service-agent/tests/agents.test.js` runs 1,000 simulated customer messages saying "I paid, here is the proof," and asserts the system never calls `payment_verify` on its own. The orchestrator's audit log is checked; the count must be 0.

## 5. Receipts / screenshots — storage

**M0:** Local disk under `service-agent/storage/receipts/<booking_id>/<uuid>.<ext>`. Served by an authenticated route: `GET /api/admin/payments/<payment_id>/screenshot` (owner-only). The URL is opaque; it's not in `messages` and not guessable.

**M1 (deferred):** Pluggable storage backend (`storage.js` interface) with an S3-compatible driver. No code change at the call site.

**Hard rules:**
- Max file size: 5 MB.
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`.
- Filename is the UUID; the original extension is preserved.
- Files older than the booking's `deleted_at` + 90 days are purged by a nightly job.

## 6. The dashboard's "Payments" section

See `DASHBOARD_PLAN.md` §2.5. Concretely:

- **Pending review** is the default tab.
- **Verified** is the second tab, with date range and cleaner filters.
- **All-time totals** are a small KPI strip: total verified, total pending, total rejected (lifetime).
- **Export:** CSV download of verified payments in a date range. **Owner-only.** The export columns: `public_ref, customer_name, service, amount, currency, method, verified_at, verified_by_name`.

## 7. Edge cases (the "what if" list)

| What if | What happens |
|---|---|
| Customer submits 2 references for the same booking | First wins, second is silently logged as `payment_events` `event_type = 'DUPLICATE_SUBMISSION'`. |
| Customer submits a screenshot of a different amount | Owner sees the amount field in the form (we ask the customer to type it in path C); for A/B the dashboard surfaces the booking's expected amount. Owner can decide. |
| Customer sends a WhatsApp voice note saying "I paid" | Orchestrator runs `handoff_to_human`; owner responds. We do not transcribe voice in M0. |
| Owner is offline for 8 hours | Queue grows; older entries highlight in red; nothing auto-expires. |
| Screenshot URL is broken (file deleted) | Dashboard shows a "Screenshot unavailable" placeholder; owner can still verify/reject based on context. |
| Two owners try to verify the same payment at the same time | First write wins (DB UNIQUE on `payments.id` + `updated_at`). The second sees a stale-read warning and is asked to refresh. |
| Customer wants a refund | M0: owner manually refunds (out of band) and marks the booking `CANCELLED_BY_OWNER` with reason "refunded." M1: proper refund flow. |
| Customer claims they paid but no record exists | Owner asks for the InstaPay reference; the customer provides it; `payment_record_submission` with the reference. |

## 8. Switching to a real gateway later

The flow is designed so that swapping `INSTAPAY_*` for a real gateway (e.g. Paymob, Fawry) is **one tool change**:

- Replace `payment_record_submission`'s handler with a gateway call that returns a hosted checkout URL.
- Replace the customer message `PAYMENT_INSTRUCTIONS` with `PAYMENT_CHECKOUT` that includes the URL.
- Replace `payment_verify` with a webhook handler that updates `payments.status` on gateway confirmation.
- The data model (`payments`, `payment_events`) and the dashboard do not change.

**No code in the dashboard, AI orchestrator, or scheduler changes when we swap gateways.** That's the design.

## 9. Acceptance for the payment flow

- Booking `CONFIRMED` → `PAYMENT_INSTRUCTIONS` message lands in the customer's channel within 5 seconds. ✅
- Customer reply with image → `payments.status = PENDING_REVIEW` within 5 seconds; dashboard "Pending review" updates via Socket.io. ✅
- Owner clicks Approve → `payments.status = VERIFIED`, customer receives `PAYMENT_VERIFIED` within 5 seconds. ✅
- Owner clicks Reject without selecting a reason → button is disabled; the API rejects `400 reason_required`. ✅
- Rejected payment → customer receives `PAYMENT_REJECTED` + a fresh `PAYMENT_INSTRUCTIONS`. ✅
- AI never calls `payment_verify` in 1,000 simulated conversations (regression test). ✅
- A booking with `payment_status != 'PAID'` cannot transition to `ASSIGNED`. ✅
- A `payments` row cannot be soft-deleted via the public API. ✅
- `payment_events` cannot be updated or deleted (DB trigger test). ✅
- All payment actions appear in the owner audit log with actor and timestamp. ✅

## 10. Open questions

| # | Question | Owner | Due |
|---|---|---|---|
| Q1 | Do we collect a screenshot for `CASH` bookings too (e.g. receipt photo)? | Product | Day 5 |
| Q2 | Should we send a "did you forget to pay?" reminder at +2h, +12h, +24h after CONFIRMED? | Product | Day 3 |
| Q3 | Tax: do we need a separate `tax` column on `payments`, or is the service price tax-inclusive? | Product (with accountant) | Day 7 |
| Q4 | Receipt archival period: 90 days or 5 years (accounting law)? | Product | Day 7 |
