# MVP Scope — Phase 1

> Status: **DRAFT v1.0** • Owner: Product (Hermes)
> Companion to `PRODUCT_VISION.md`. Defines what ships, what doesn't, and the acceptance bar for each item.

---

## 1. North-star milestone (M0)

> **Customer creates a booking → booking appears in dashboard calendar → owner assigns cleaner → payment is verified → customer gets a confirmation.**

Every other Phase 1 feature exists to make this scenario reliable. If a feature doesn't make this scenario more reliable, it does not ship in Phase 1.

## 2. The 10 must-have features (with acceptance criteria)

Each feature lists: **What** (one line) • **Why** (which JTBD) • **Acceptance test** (pass/fail) • **Owner agent** • **Priority**.

### F1 — Owner login & dashboard shell [MUST]
- **What:** JWT-based owner login, RBAC-ready, dashboard at `/dashboard`.
- **Why:** JTBD-3. Nothing else is reachable without it.
- **Acceptance:**
  - `POST /api/auth/login` with valid creds returns 200 + JWT; invalid returns 401.
  - All `/api/admin/*` and `/api/owner/*` routes 401 without JWT.
  - Localhost dev bypass is gated behind `NODE_ENV=development` AND explicit `ENABLE_DEV_BYPASS=true`. **Never on in staging/prod.**
  - Login page renders EN + AR (RTL) + DE.
  - Logout invalidates the token client-side and server-side (blacklist or short TTL).
- **Owner:** Coding Engineer (backend) + Frontend agent (UI).
- **Priority:** P0.

### F2 — Real booking intake (form + chatbot + WhatsApp + email) [MUST]
- **What:** All four channels write to the same `bookings` table via the same orchestrator.
- **Why:** JTBD-1. Single source of truth for intake.
- **Acceptance:**
  - `POST /api/public/bookings` creates a `bookings` row in any of these statuses: `INTAKE_INCOMPLETE`, `PENDING_CONFIRMATION`, `CONFIRMED`.
  - The website form (`landing-page/src/features/booking-form.js`) posts to `/api/public/bookings`, not `/api/bookings`. Field names match the API contract (`customerName`, `phone`, `carType`, `serviceId`, `address`, `scheduledStart`).
  - **The "fake local success" fallback is deleted.** On API failure, the form shows a real error and offers WhatsApp as a fallback.
  - Chatbot widget default API URL is read from a build-time env (`VITE_API_BASE_URL` or widget init option), not hardcoded to `localhost:5000`.
  - WhatsApp inbound webhook creates a `chat_session` and routes through the orchestrator.
  - Email inbound (parseable via subject prefix `BOOK:` or designated mailbox) creates the same `chat_session`.
  - Required fields: `customerName`, `phone` (E.164 or local EG), `serviceId`, `scheduledStart`. Missing fields → `INTAKE_INCOMPLETE`, AI asks for them.
- **Owner:** Coding Engineer.
- **Priority:** P0.

### F3 — Working chatbot (multilingual, tool-first) [MUST]
- **What:** Widget + `/api/public/chat` + orchestrator that collects, books, hands off.
- **Why:** JTBD-1.
- **Acceptance:**
  - Returning customer is greeted by name (Mem0 lookup, fallback to "Hello").
  - Arabic replies are Egyptian colloquial — fixture test asserts at least one marker (`يا فندم`, `منورنا`, `حبيبي`, `تمام يا باشا`).
  - The bot never confirms a slot without calling `SlotValidator`. A/B test with mocked validator must fail if the bot says "booked" without a tool call.
  - `handoff` tool produces a real `handoff_tickets` row visible in the dashboard inbox.
  - All messages persist in `chat_messages` with `role`, `content`, `language`, `channel`, `createdAt`.
  - Widget renders on the landing page in EN + AR (RTL) + DE.
- **Owner:** AI/Agent agent.
- **Priority:** P0.

### F4 — Real, normalized booking database [MUST]
- **What:** `customers`, `vehicles`, `services`, `bookings`, `booking_status_history`, `agent_actions`. Migrations, not `CREATE TABLE` sprinkled in `database.js`.
- **Why:** Foundational. Every other feature reads from it.
- **Acceptance:**
  - All schemas live in `service-agent/migrations/NNN_*.js` and are idempotent.
  - `service-agent/database.js` becomes a thin connection wrapper, not a schema file.
  - Foreign keys enforced (`PRAGMA foreign_keys = ON`).
  - Seed script: 1 owner, 3 services, 2 cleaners, 1 demo customer + booking.
  - Migration test: a fresh DB runs all migrations to the same schema as a migrated DB.
- **Owner:** Coding Engineer (DB agent).
- **Priority:** P0.

### F5 — Calendar connected to bookings + assignment-aware availability [MUST]
- **What:** Calendar is the **view** of bookings, not a confirmation artifact. Availability considers assigned cleaners, working hours, and service duration.
- **Why:** JTBD-3.
- **Acceptance:**
  - Dashboard calendar view (day / week) reads from `bookings` + `assignments` only. The old `calendar_events` table is deprecated (read-only fallback for one release, then dropped).
  - Slot check tool: returns `available`, `full`, or `outside_hours` for a given `(date, hour, serviceId)`; max N concurrent = `min(2, count(cleaners_on_shift))`.
  - Timezone: `Africa/Cairo` everywhere. No string dates — store ISO with offset, render in local.
  - Drag-to-reschedule: owner can move a booking; writes a `booking_status_history` row with `from`, `to`, `actor`, `reason`.
  - Holiday support: a `holidays` table (even empty in M0) is referenced by the SlotValidator.
- **Owner:** Coding Engineer.
- **Priority:** P0.

### F6 — Manual InstaPay / payment tracking [MUST]
- **What:** Customer gets payment instructions, submits proof, owner verifies in dashboard.
- **Why:** JTBD-4. **No official InstaPay API exists that we can credibly claim to integrate with.**
- **Acceptance:**
  - After booking is `CONFIRMED`, system sends payment instructions (WhatsApp + email) with: receiving number, optional QR, optional link, exact amount, booking reference.
  - Customer reply path: WhatsApp with screenshot OR upload via web form OR reply email with reference number.
  - Submission creates a `payments` row with `status = PENDING_REVIEW`, `submittedAt`, `method = INSTAPAY`, `reference` (free text), `screenshotUrl` (optional).
  - Booking payment status becomes `PAYMENT_PENDING_REVIEW`.
  - Owner sees a "Pending review" queue in the dashboard. Approve → `status = VERIFIED`, `verifiedBy`, `verifiedAt`; booking → `PAID`. Reject → `status = REJECTED`, `reason`; booking → back to `UNPAID` with a customer message.
  - All payment actions write to `payment_events` (audit).
  - **The system never says "paid" without `status = VERIFIED`. No exceptions.**
- **Owner:** Integrations agent + Coding Engineer.
- **Priority:** P0.

### F7 — Staff / cleaner assignment [MUST]
- **What:** Cleaners can log in, see their assigned jobs, update status.
- **Why:** JTBD-3 + field worker persona.
- **Acceptance:**
  - `staff` table with `role` (`OWNER`, `DISPATCHER`, `CLEANER`), `phone`, `active`, `shiftStart`, `shiftEnd`.
  - Owner can assign a booking to one cleaner (or "any available") from the dashboard.
  - Cleaner login (`/login?role=cleaner` or `/cleaner`) sees only their own jobs, today + tomorrow, with: time, address, car, service, payment status, customer phone (click to call/WhatsApp).
  - Status transitions cleaner can make: `ASSIGNED → EN_ROUTE → ON_SITE → IN_PROGRESS → COMPLETED` (or `NO_SHOW`).
  - Each transition writes a `booking_status_history` row.
- **Owner:** Coding Engineer + Frontend agent.
- **Priority:** P0.

### F8 — Customer confirmation & reminder messages [MUST]
- **What:** Automated messages at each lifecycle event, in the customer's language and channel of choice.
- **Why:** JTBD-1 + JTBD-2.
- **Acceptance:**
  - Templates in `service-agent/messages/templates.{en,ar,de}.json` — pure data, no logic in templates.
  - Triggers: `BOOKING_RECEIVED`, `BOOKING_CONFIRMED`, `PAYMENT_INSTRUCTIONS`, `PAYMENT_VERIFIED`, `CLEANER_ASSIGNED`, `CLEANER_EN_ROUTE`, `JOB_COMPLETED`, `REVIEW_REQUEST`.
  - Channel selection: WhatsApp first if `customer.phone` is reachable, else email, else in-app/chat reply.
  - Reminder job: cron at 09:00 and 14:00 Africa/Cairo sends next-day reminders to all `CONFIRMED` or `PAID` bookings.
  - Every outbound message persists in `messages` with `provider`, `providerMessageId`, `status` (sent / delivered / failed).
- **Owner:** Integrations agent.
- **Priority:** P0.

### F9 — Human takeover (owner can intercept any conversation) [MUST]
- **What:** Owner can claim any chat session; the bot steps back until released.
- **Why:** JTBD-3.
- **Acceptance:**
  - Dashboard has a "Take over" button on every active chat session.
  - After takeover, the bot does not auto-reply; the owner types into the same channel the customer is on.
  - Owner can release the session back to AI ("Hand back to AI").
  - A `handoff_tickets` row is opened on takeover and closed on release, with `reason` and `outcome`.
  - If owner doesn't reply within 5 minutes during working hours, bot resumes with a "Back to you, anything else?" prompt (configurable).
- **Owner:** Coding Engineer + AI/Agent agent.
- **Priority:** P0.

### F10 — Tests, build, CI [MUST]
- **What:** Real test pyramid, real CI, real coverage.
- **Why:** Without this, nothing else is durable.
- **Acceptance:**
  - Unit tests (Vitest): ≥ 200 passing, ≥ 60% line coverage in `service-agent/`.
  - Integration tests: booking intake → confirm → assign → verify payment → complete, end-to-end via API.
  - E2E tests (Playwright): 3 languages, 3 personas (customer, owner, cleaner), 5 critical paths.
  - CI on every PR: lint + typecheck + unit + integration + build.
  - `npm run build` works at the root (currently broken — see `CLEANUP_PLAN.md`).
- **Owner:** QA agent + Coding Engineer.
- **Priority:** P0.

## 3. Should-have (M0.x, post-launch-week-1)

These are not gating M0, but they ship in the same release if time allows. If they slip, they go to M1, not phase 2.

- **S1.** Receipt screenshot storage (S3-compatible / local disk + URL) with thumbnail.
- **S2.** Owner-side calendar drag-to-assign cleaner.
- **S3.** Customer self-service status page (tokenized URL, no login).
- **S4.** Cleaner PWA install (Add to Home Screen prompt).
- **S5.** Webhook for cleaner status updates to owner (push when cleaner marks EN_ROUTE).

## 4. Later / nice-to-have (M1, ~2–4 weeks after M0)

- **L1.** Multi-cleaner auto-assignment with travel-time heuristic.
- **L2.** Google Calendar two-way sync (read-only first).
- **L3.** Refund flow (partial / full) with audit trail.
- **L4.** Customer satisfaction rating (1–5 + comment) with auto-flag at < 3.
- **L5.** Cleaner performance dashboard.
- **L6.** Service-area zones (postcode → ETA + price modifier).

## 5. Phase 2 (explicit deferral — not in this rebuild)

- **P2-A.** TikTok auto-publishing.
- **P2-B.** Instagram / Facebook content scheduling.
- **P2-C.** Advanced email drip campaigns.
- **P2-D.** Full marketing autopilot (Postiz orchestrator, growth analytics, A/B testing).
- **P2-E.** Multi-tenant SaaS (multiple car wash businesses on one instance).
- **P2-F.** Loyalty / referral / coupon system.
- **P2-G.** Mobile native apps (iOS / Android).

**Hard rule for the team:** *No Phase 2 ticket gets a Phase 1 estimate.* If a feature is in P2, it does not appear in M0 sprints. If you find yourself adding "and also let me add TikTok" to a Phase 1 PR, you are doing it wrong.

## 6. Out-of-scope guardrails (the "we are not building X" list)

These were considered and rejected for the rebuild, in writing, so we don't relitigate them.

- **AI-driven dynamic pricing.** Manual price list in M0.
- **Voice agent.** Channel is text-only in M0.
- **Real-time GPS tracking of cleaners.** Cleaner manual status updates in M0.
- **Customer-facing app store apps.** PWA only.
- **Open API for third parties.** Internal only in M0.
- **Stripe / international cards.** InstaPay manual only in M0.

## 7. Definition of Done for the whole MVP

The MVP is done when **all 10 must-haves pass their acceptance tests in production**, the owner has run the M0 scenario three times without a human typing in WhatsApp, and CI is green for 5 consecutive days. Everything in "Should" is best-effort.
