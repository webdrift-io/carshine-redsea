# Product Vision — CarShine Red Sea Autopilot

> Status: **DRAFT v1.0** • Owner: Product (Hermes) • Last update: 2026-06-15
> Single source of truth for *what we are building* and *what we are not*.

---

## 1. One-line vision

**An AI autopilot that runs a real mobile car wash delivery business in El Gouna / Hurghada / Sahl Hasheesh — taking a customer from first WhatsApp message to a paid, assigned, completed wash, with the owner only stepping in when the AI asks for help.**

This is not a chatbot demo. This is not a marketing site. This is an operations console with an AI front door.

## 2. The business we serve

| Attribute | Value |
|---|---|
| Service area | El Gouna, Hurghada, Sahl Hasheesh (Red Sea, Egypt) |
| Service type | Mobile car wash — we come to the customer's door / hotel / marina |
| Languages | English, **Egyptian Arabic (colloquial, not Fusha)**, German |
| Working hours | 09:00 – 17:00 local (Africa/Cairo) |
| Capacity | Max 2 concurrent washes per hour, scaling with cleaner count |
| Pricing | Per service + per vehicle size; cash or InstaPay |
| Staff model | 1–N cleaners + 1 dispatcher/owner |
| Real money | Yes — payments tracked, refunds possible |

## 3. The problem we solve

Today the owner runs the business out of WhatsApp, memory, and a notebook. The audit confirmed it: a customer books, the owner types a confirmation by hand, payment is "I'll send you a transfer, just send me the screenshot," assignment is "call Mahmoud and see if he's free," and reminders are "I remembered to text them." That's not a business. That's a job.

We replace that with a system that:
1. Captures the lead from any channel.
2. Collects the missing fields.
3. Books a real slot against real capacity.
4. Tracks payment honestly.
5. Assigns a real cleaner.
6. Notifies the customer automatically.
7. Lets the owner override at any point.

## 4. The four jobs the system must do (Jobs-to-be-Done)

**JTBD-1 — "I want my car washed without calling anyone."**
Customer can book in under 60 seconds through web form, chatbot, WhatsApp, or email. They get an instant confirmation, a reminder, and a real person shows up.

**JTBD-2 — "I want to know what's happening with my booking."**
Customer can see status (received → confirmed → paid → assigned → on the way → done) without asking anyone.

**JTBD-3 — "I want to run my business without it running me."**
Owner opens one dashboard, sees everything live, and only intervenes when AI hands something over.

**JTBD-4 — "I want to know if I actually got paid."**
Every booking has a payment record: pending → submitted → verified (or rejected), with a receipt and an audit trail.

## 5. Channels the system owns in Phase 1

| Channel | Direction | Phase 1 |
|---|---|---|
| Website form | Inbound | ✅ Build |
| Chatbot widget (web) | Inbound + Outbound | ✅ Build |
| WhatsApp (Meta Cloud API) | Inbound + Outbound | ✅ Build |
| Email (SMTP) | Inbound + Outbound | ✅ Build (text only, no templates in marketing sense) |
| Phone call | — | ❌ Out of scope |
| Instagram / TikTok / Facebook DMs | — | ⏸ Phase 2 (marketing autopilot) |

## 6. The three personas

### 6.1 Customer (the buyer)
- Doesn't care about our tech stack.
- Cares: "did someone confirm, will they show up, how do I pay, did it happen."
- Pain today: no one replies, no one shows up, payment is ambiguous.
- Success metric: **booked → washed without the customer sending a follow-up message.**

### 6.2 Owner / Dispatcher (the operator)
- One person (or a tiny team) running the business.
- Cares: live view of jobs, who owes what, who is free, what needs approval.
- Pain today: a dozen open WhatsApp chats, no record, no payment certainty, no-shows.
- Success metric: **closes the laptop at 17:00 knowing every booking is either done, paid, or has a clear next action.**

### 6.3 Cleaner (the field worker)
- Gets a job on their phone with address, time, car, service, price, payment status.
- Cares: clear instructions, easy status update, no confusion.
- Pain today: voice notes from the owner, lost context, "where do I go again?"
- Success metric: **opens the app, sees the next job, marks done, moves on.**

## 7. What "AI autopilot" means in this product

The AI is not a chatbot. The AI is a **front-office operator** that:

1. **Listens** on every channel.
2. **Routes** to the right tool (intake, booking, payment, handoff).
3. **Decides** when to ask the human (owner takeover).
4. **Speaks** in the customer's language with the right tone (Egyptian Arabic colloquial, never Fusha).
5. **Remembers** returning customers (Mem0) and never asks twice.
6. **Stops** the moment the owner says "I'll take this one."

The AI never invents availability, never confirms a payment, never books a slot the SlotValidator hasn't approved.

## 8. Non-negotiable product principles

1. **Real data, always.** Every screen reflects the database. No mock state, no fake success.
2. **One source of truth for the booking intake path.** The website form, the chatbot, WhatsApp, and email all land in the same `bookings` table via the same orchestrator.
3. **Manual payments are honest.** We never claim "paid" until an admin (or a future real API) verifies. Status flow: `UNPAID → PENDING_REVIEW → VERIFIED` (or `REJECTED`).
4. **Tool-first, LLM-trust-zero.** Slot checks, customer lookups, payment recordings, assignment changes — all happen through tools that return hard data, not LLM prose.
5. **Override-able.** Every AI action can be reversed, edited, or taken over by a human.
6. **Audit trail.** Every status change records who/what/when/why.
7. **Three languages, every feature.** A feature doesn't ship until EN + AR (RTL) + DE work.

## 9. Explicitly out of scope for the rebuild (Phase 2+)

We are **not** building these in Phase 1. Naming them keeps us honest.

- TikTok auto-publishing
- Instagram / Facebook content scheduling
- Advanced email drip campaigns
- Growth analytics dashboards
- Loyalty programs / coupons / referrals
- Multi-tenant SaaS (this is one business, one owner)
- Mobile native apps (PWA or responsive web only)
- IoT / connected vehicle / fleet telematics
- Subscription billing / recurring plans

## 10. Success criteria for the rebuild (the "done" bar)

The rebuild is **done** when the following scenario plays out end-to-end without a human typing in WhatsApp:

> A tourist in El Gouna opens the website on their phone, chats with the bot in Arabic, books a "Sedan — exterior + interior" for tomorrow 10:00 at their hotel, gets a WhatsApp confirmation with payment instructions, sends an InstaPay screenshot back, the owner sees it as `PENDING_REVIEW` in the dashboard, clicks Verify, assigns it to Mahmoud, Mahmoud sees it on his phone, drives there, marks the job "Done," the system sends the customer a "Thanks, please rate us" message, and the owner closes the day with a `VERIFIED` payment and a `COMPLETED` booking on the timeline. **No one invented a number. Every step is in the database.**

That's the bar. Everything in `MVP_SCOPE.md` exists to make that scenario real.
