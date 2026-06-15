# Agent Tools Plan

> Status: **DRAFT v1.0** • Owner: AI/Agent agent (with Coding Engineer for tool implementations)
> Defines the exact tools the AI orchestrator can call, their inputs/outputs, and which agents can call which.

---

## 1. The shape of an agent tool

All tools live in `service-agent/agents/tools.js` (extended) and conform to a single contract:

```js
{
  name: 'slot_check',
  description: '...short, for the LLM prompt...',
  input_schema: { /* JSON Schema, validated by Ajv */ },
  output_schema: { /* JSON Schema */ },
  required_role: 'PUBLIC' | 'CUSTOMER' | 'OWNER' | 'CLEANER' | 'INTERNAL',
  side_effects: 'NONE' | 'READ' | 'WRITE' | 'SENSITIVE_WRITE',
  rate_limit: { per: 'session', max: 10, window: '1m' },
  handler: async (input, ctx) => { /* returns output or throws ToolError */ }
}
```

Three rules:
1. **Tools are pure-ish.** A tool that takes a `bookingId` cannot create a different booking. Tools have one job.
2. **Tools are the only way the AI mutates state.** The LLM never writes the DB directly. It returns a `tool_call`, the orchestrator validates the call against `input_schema` and `required_role`, and the handler runs.
3. **Every tool call is logged** to `agent_actions` (§4.14 of schema plan) with the full input and output, redacted of secrets.

## 2. Tool inventory for M0

Organized by capability. Each gets a one-line description for the LLM, a JSON-schema-shaped input/output, and an acceptance test.

### 2.1 `customer_lookup`
**Purpose:** Find a customer by phone/email so we don't re-ask.

| | |
|---|---|
| Inputs | `{ phone?: string, email?: string }` |
| Outputs | `{ found: boolean, customer?: Customer, last_booking?: Booking, language_guess?: 'en'\|'ar'\|'de' }` |
| Role | PUBLIC |
| Side effects | READ |
| Acceptance | Phone match ignores spaces, `+20`, leading `0`. Email match is case-insensitive. Returns `found: false` cleanly, never throws. |

### 2.2 `customer_upsert`
**Purpose:** Create or update a customer record from intake data.

| | |
|---|---|
| Inputs | `{ full_name: string, phone_e164?: string, phone_raw?: string, email?: string, language?: string, address?: string, area?: string, notes?: string }` |
| Outputs | `{ customer: Customer, created: boolean }` |
| Role | CUSTOMER, OWNER |
| Side effects | WRITE |
| Acceptance | Re-uses by phone_e164, then by email. Returns `created: false` if matched, `true` if new. |

### 2.3 `vehicle_upsert`
**Purpose:** Save the car details on the booking.

| | |
|---|---|
| Inputs | `{ customer_id: string, car_type: 'SEDAN'\|'SUV'\|'PICKUP'\|'VAN'\|'OTHER', make?, model?, color?, plate?, notes? }` |
| Outputs | `{ vehicle: Vehicle, created: boolean }` |
| Role | CUSTOMER, OWNER |
| Side effects | WRITE |
| Acceptance | Plate is optional. One customer can have many vehicles; the latest is the "default." |

### 2.4 `slot_check`
**Purpose:** The source of truth for availability. **The LLM cannot book without this passing first.**

| | |
|---|---|
| Inputs | `{ scheduled_start: ISO8601, service_id: string, preferred_staff_id?: string }` |
| Outputs | `{ available: boolean, reason?: 'OUTSIDE_HOURS'\|'HOLIDAY'\|'FULL'\|'STAFF_BUSY'\|'PAST', suggested_slots?: ISO8601[], capacity: { total: number, taken: number } }` |
| Role | PUBLIC, CUSTOMER, OWNER |
| Side effects | READ |
| Acceptance | Max concurrent = `min(2, count(active_cleaners_on_shift))`. Returns 3 suggested slots within ±48h when full. Refuses to check past slots. |

### 2.5 `booking_create`
**Purpose:** Create a real booking. **Only callable after `slot_check.available === true`.**

| | |
|---|---|
| Inputs | `{ customer_id, vehicle_id?, service_id, scheduled_start, source: 'WEB_FORM'\|'CHATBOT'\|'WHATSAPP'\|'EMAIL'\|'OWNER', language?, notes? }` |
| Outputs | `{ booking: Booking, payment_instructions: { amount_egp: number, receiving_number: string, qr_url?: string, payment_link?: string, reference_template: string } }` |
| Role | CUSTOMER, OWNER |
| Side effects | WRITE (sensitive — creates `bookings` + initial `booking_status_history` + `payments` row) |
| Acceptance | Refuses if slot_check would fail (re-checks atomically inside the tool, in a transaction). Assigns `public_ref`. Returns payment instructions for the booking. |

### 2.6 `booking_get`
**Purpose:** Read a booking by id or `public_ref`. Used by cleaner to load a job; by owner for dashboard.

| | |
|---|---|
| Inputs | `{ id?, public_ref? }` |
| Outputs | `{ booking: BookingWithJoins, can_view: boolean }` |
| Role | OWNER (any), CLEANER (only if assigned), CUSTOMER (only if `public_ref` matches AND a token in URL matches `booking_view_tokens`) |
| Side effects | READ |
| Acceptance | `can_view: false` never leaks the booking — returns a redacted `{ id, status, payment_status }` only. |

### 2.7 `booking_update_status`
**Purpose:** Move a booking along the state machine. **The only tool that can change `status` or `payment_status`.**

| | |
|---|---|
| Inputs | `{ booking_id, to_status, reason?, metadata? }` |
| Outputs | `{ booking: Booking, transition: { from, to, at } }` |
| Role | OWNER, CLEANER (only their assigned booking, only into cleaner-allowed transitions), AI (only into AI-allowed transitions) |
| Side effects | WRITE |
| Acceptance | Rejects invalid transitions. Writes `booking_status_history` row. Emits a Socket.io `booking:updated` event. **Never** lets the AI set `COMPLETED` or `VERIFIED` (payment). |

### 2.8 `booking_reschedule`
**Purpose:** Move a booking to a new time. Re-runs `slot_check`.

| | |
|---|---|
| Inputs | `{ booking_id, new_scheduled_start, reason? }` |
| Outputs | `{ booking: Booking, transition }` |
| Role | OWNER, CUSTOMER (via `public_ref` + token) |
| Side effects | WRITE |
| Acceptance | Atomic; if new slot not available, returns error and does not write. |

### 2.9 `assign_staff`
**Purpose:** Assign or re-assign a cleaner to a booking.

| | |
|---|---|
| Inputs | `{ booking_id, staff_id, reason? }` |
| Outputs | `{ assignment: Assignment, booking: Booking }` |
| Role | OWNER, DISPATCHER |
| Side effects | WRITE |
| Acceptance | Rejects if staff is not a `CLEANER` or is inactive. Closes prior assignment (`released_at = now`). Updates `bookings.status` to `ASSIGNED` (if currently `CONFIRMED`/`PAID`). |

### 2.10 `payment_record_submission`
**Purpose:** Customer (or AI acting on customer's behalf) submits a payment reference + optional screenshot URL.

| | |
|---|---|
| Inputs | `{ booking_id, method: 'INSTAPAY'\|'CASH', reference?: string, screenshot_url?: string }` |
| Outputs | `{ payment: Payment, status: 'PENDING_REVIEW' }` |
| Role | CUSTOMER, OWNER (CASH only) |
| Side effects | WRITE |
| Acceptance | Updates `payments.status = PENDING_REVIEW`, `bookings.payment_status = PENDING_REVIEW`, appends `payment_events`. Sends a confirmation message to the customer. |

### 2.11 `payment_verify`
**Purpose:** Owner marks a payment verified or rejected. **AI never calls this.**

| | |
|---|---|
| Inputs | `{ payment_id, decision: 'VERIFY'\|'REJECT', reason? }` |
| Outputs | `{ payment: Payment, booking: Booking }` |
| Role | OWNER |
| Side effects | WRITE (sensitive) |
| Acceptance | VERIFY → `payments.status = VERIFIED`, `bookings.payment_status = PAID`, message sent to customer. REJECT → `payments.status = REJECTED`, `bookings.payment_status = UNPAID`, message sent with reason. Both append `payment_events`. |

### 2.12 `handoff_to_human`
**Purpose:** Open a handoff ticket; pause AI replies for that session.

| | |
|---|---|
| Inputs | `{ chat_session_id, reason: string, priority?: 'LOW'\|'NORMAL'\|'HIGH' }` |
| Outputs | `{ ticket: HandoffTicket }` |
| Role | AI, OWNER (manual take over) |
| Side effects | WRITE |
| Acceptance | Sets `chat_sessions.handoff_active = 1`, `handoff_owner_id = current_owner_id`. Notifies owner via Socket.io. |

### 2.13 `handoff_release`
**Purpose:** Return the chat to AI.

| | |
|---|---|
| Inputs | `{ chat_session_id, summary?: string }` |
| Outputs | `{ ticket: HandoffTicket }` |
| Role | OWNER |
| Side effects | WRITE |
| Acceptance | Sets `handoff_active = 0`, `handoff_owner_id = null`, `resolved_at = now`. Next inbound message goes back to AI. |

### 2.14 `send_message`
**Purpose:** Send an outbound message on any channel.

| | |
|---|---|
| Inputs | `{ customer_id, channel: 'WHATSAPP'\|'EMAIL', template_code, vars: object, booking_id? }` |
| Outputs | `{ message: Message, provider_status: 'QUEUED'\|'SENT'\|'FAILED' }` |
| Role | INTERNAL (only callable by the orchestrator, not directly by the LLM) |
| Side effects | WRITE + external I/O |
| Acceptance | Renders template, sends via provider, persists `messages` row, on provider callback appends `message_events`. |

### 2.15 `holiday_check`
**Purpose:** Returns whether a date is a holiday / closed.

| | |
|---|---|
| Inputs | `{ date: 'YYYY-MM-DD' }` |
| Outputs | `{ closed: boolean, name?: string }` |
| Role | PUBLIC |
| Side effects | READ |

## 3. Tool routing by agent

The Mastra orchestrator has 4 agents (`router`, `intake`, `booking`, `handoff`). Each agent can only call a subset:

| Tool | router | intake | booking | handoff |
|---|:-:|:-:|:-:|:-:|
| `customer_lookup` | ✅ | ✅ | ✅ | ✅ |
| `customer_upsert` | ❌ | ✅ | ✅ | ❌ |
| `vehicle_upsert` | ❌ | ✅ | ✅ | ❌ |
| `slot_check` | ❌ | ✅ | ✅ | ❌ |
| `booking_create` | ❌ | ❌ | ✅ | ❌ |
| `booking_get` | ❌ | ✅ | ✅ | ✅ |
| `booking_update_status` | ❌ | ⚠️ (limited) | ⚠️ (limited) | ❌ |
| `booking_reschedule` | ❌ | ❌ | ✅ (offer) | ❌ |
| `assign_staff` | ❌ | ❌ | ❌ | ❌ |
| `payment_record_submission` | ❌ | ❌ | ✅ | ❌ |
| `payment_verify` | ❌ | ❌ | ❌ | ❌ |
| `handoff_to_human` | ✅ | ✅ | ✅ | ✅ |
| `handoff_release` | ❌ | ❌ | ❌ | ✅ |
| `send_message` | ❌ | ⚠️ (templates only) | ⚠️ (templates only) | ✅ |
| `holiday_check` | ❌ | ✅ | ✅ | ❌ |

⚠️ = AI can call, but the orchestrator restricts the `to_status` set.

## 4. Tool validation pipeline

```
LLM emits tool_call
        │
        ▼
┌──────────────────┐
│ Validate name     │  unknown tool → reject, log
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Validate input    │  Ajv against input_schema → reject on first error
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Check role        │  ctx.role vs tool.required_role → reject
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Rate limit        │  in-memory token bucket per (session, tool)
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Run handler       │  wrapped in try/catch, 5s timeout
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Log to agent_actions
└────────┬─────────┘
         ▼
Return output to LLM
```

A rejected tool call is **never** silent. The LLM gets a structured error so it can self-correct.

## 5. Deterministic short-circuit (the "Mastra-style no-LLM path")

The orchestrator's `decision.js` runs a deterministic classifier before invoking any LLM. It recognizes:

- "I want to book a wash tomorrow at 10" → goes straight to `intake → booking` with the parser
- "What time are you open?" → answers from `website-knowledge.js`, no LLM
- "Cancel my booking" → handoff ticket (owner intervenes for confirm)
- "Where's my car wash?" → `booking_get` + status reply

LLM is only invoked when the deterministic path gives a confidence < 0.7. This is what the audit meant by "active AI is mostly deterministic unless `ENABLE_LLM_REPLY_TEXT=true`." We make the deterministic path the **primary** path; the LLM is a backstop.

## 6. Mem0 integration

`mem0.js` is wired into `customer_lookup` and the `intake` agent's greeting. Rules:

- Lookup is best-effort: if Mem0 returns nothing or errors, fall back to DB.
- We never send PII to Mem0 we don't already have. The fields written: `customer_id`, `language`, `last_service`, `last_visit_date`, `tags`. No phone, no email, no address.
- A returning customer (matched by `customer_lookup`) gets a greeting with their name and last service. **Fixture test asserts this.**

## 7. Langfuse integration

- Every `orchestrator.generate()` is wrapped in a Langfuse trace.
- Tags per trace: `chatSessionId`, `language`, `channel`, `finalOutcome` (`booked` | `handoff` | `info` | `abandoned`), `toolCallCount`, `latencyMs`.
- Dry-run mode if no Langfuse keys. No exceptions thrown to the orchestrator.

## 8. Tool testing requirements

For every tool:
- A unit test in `service-agent/tests/tools/<tool_name>.test.js` covering the happy path and at least 2 failure paths.
- A schema-validation test: an invalid input shape must throw `ToolValidationError`.
- A role-check test: a wrong-role caller must throw `ToolPermissionError`.
- An idempotency check where applicable (e.g., `payment_record_submission` called twice with the same data must not double-write).

## 9. Tools NOT in M0 (deferred)

- `pricing_quote` — manual price list in M0.
- `route_eta` — no GPS in M0.
- `translate_message` — the LLM does it inline.
- `refund_create` — M1.
- `coupon_apply` — Phase 2.

## 10. Acceptance for the agent tools plan

- `agents/tools.js` exports exactly the 15 tools in §2.
- Each has a JSON schema for input and output.
- Each has at least the 4 tests described in §8.
- The LLM cannot call `payment_verify` (test: orchestrator audit shows 0 calls in 1,000 simulated conversations).
- The LLM cannot produce a `booking.status = COMPLETED` (test: 1,000 simulated conversations, 0 successful).
- A simulated customer asking "what time are you open" produces a deterministic reply in < 50ms with 0 LLM tokens consumed.
