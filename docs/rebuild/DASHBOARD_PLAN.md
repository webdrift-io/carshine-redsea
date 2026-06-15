# Dashboard Plan

> Status: **DRAFT v1.0** • Owner: Frontend agent (with Coding Engineer for backend endpoints)
> The dashboard is the owner's operations console. Every screen shows real DB state. No mock data. No hardcoded lists.

---

## 1. The five personas and their dashboard variants

| Persona | Path | Auth | What they see |
|---|---|---|---|
| Owner | `/dashboard` | JWT, role = OWNER | Everything |
| Dispatcher | `/dashboard` | JWT, role = DISPATCHER | Everything except financial exports + user mgmt |
| Cleaner | `/cleaner` | JWT, role = CLEANER | Only their own jobs, today + tomorrow |
| Public customer | `/b/<public_ref>?t=<token>` | Token in URL | Status of their own booking only |
| Anonymous | `/login` | — | Login form only |

**Hard rule:** The cleaner's `/cleaner` is **not** `/dashboard` with a flag. It's a separate, simpler SPA-like view, optimized for one-handed phone use.

## 2. The seven dashboard sections (Owner / Dispatcher)

A sidebar with seven items. Each item has its own page; the home page is the **Today** view.

### 2.1 Today (default landing)
A single-screen, scannable view of the day.

| Block | Source | Content |
|---|---|---|
| Clock + local time | client | `Africa/Cairo` always |
| "Right now" | `bookings WHERE status = 'IN_PROGRESS' OR 'ON_SITE'` | Cleaner name, customer, address (truncated), phone (click-to-call/WhatsApp) |
| "Up next" | `bookings WHERE status IN ('ASSIGNED','EN_ROUTE') AND scheduled_start < NOW + 2h` | Same fields |
| "Needs approval" | `bookings WHERE status = 'PENDING_CONFIRMATION'` + `payments WHERE status = 'PENDING_REVIEW'` | Count + jump to respective section |
| "Unassigned" | `bookings WHERE status = 'CONFIRMED' AND NOT EXISTS (assignment)` | Count + list |
| "Cash to collect" | `bookings WHERE payment_status = 'CASH_ON_COMPLETION'` (not in M0; placeholder card) | |
| KPI strip | server-aggregated | Today's bookings, today's revenue (VERIFIED only), % paid, % completed |

**No marketing cards. No agent list. No social metrics.** This is the operations screen.

### 2.2 Calendar
**Two views:** Day and Week. Read from `bookings` + `assignments` only.

- Day view: 09:00–17:00 hourly grid, max 2 lanes per hour. Each booking is a card with: time, customer, service, cleaner (if assigned), payment dot (green/yellow/red).
- Week view: 7 columns, each cell shows booking count + a "+ N more" if > 3.
- Click a card → side drawer with full booking detail.
- Drag a card to a new time → calls `booking_reschedule` (owner-only). If the new slot is full, the move is rejected with a toast.
- Color states: gray `INTAKE_INCOMPLETE`, blue `PENDING_CONFIRMATION`, indigo `CONFIRMED`, green `PAID`, orange `ASSIGNED`/`EN_ROUTE`, light green `ON_SITE`/`IN_PROGRESS`, emerald `COMPLETED`, red `NO_SHOW`/`CANCELLED_*`.
- Holiday days: gray-out + label.

### 2.3 Bookings
Sortable, filterable table.

| Column | Source |
|---|---|
| `public_ref` | bookings |
| Customer | customers.full_name (link to drawer) |
| Service | services.name (in current UI language) |
| Date / Time | bookings.scheduled_start (in `Africa/Cairo`) |
| Status | bookings.status (badge) |
| Payment | bookings.payment_status (badge) |
| Cleaner | assignments.staff_id (or "Unassigned") |
| Source | bookings.source |
| Actions | View / Reschedule / Cancel / Assign |

Filters: status (multi), payment_status (multi), date range, service, source, cleaner, language.
Bulk actions: send reminder, export CSV.

### 2.4 Conversations
A unified inbox of every active chat.

- Left rail: list of `chat_sessions` ordered by `last_message_at desc`, with channel icon (web/WhatsApp/email), customer name, language flag, last message preview, handoff indicator.
- Center: message thread, paginated, with the customer's language auto-applied to the reply box.
- Right rail: customer context card — phone, email, last 5 bookings, lifetime value (verified payments only), tags, "AI on/off" toggle, "Take over" / "Hand back" buttons.
- "Take over" → opens a handoff ticket, sets `chat_sessions.handoff_active = 1`, the bot stops auto-replying, owner's messages go through the same channel the customer is on.
- "Hand back" → closes the handoff ticket, AI resumes.
- "Send payment instructions" → one-click send of the standard `PAYMENT_INSTRUCTIONS` template for the active booking.

### 2.5 Payments
- Pending review queue: every `payments WHERE status = PENDING_REVIEW`. Row shows: booking ref, customer, amount, method, reference, screenshot thumbnail, submitted_at, age. Approve / Reject buttons (with required reason on reject).
- Verified list: every `payments WHERE status = VERIFIED`. Date range, cleaner, customer filters.
- All-time totals: by method, by day, by cleaner.
- Export: CSV / XLSX of verified payments in a date range. **Owner-only.**

### 2.6 Staff
- Table of all `users WHERE role != OWNER`.
- Columns: name, role, phone, active, last login, jobs today, jobs this week.
- Actions: activate/deactivate, edit shift hours, reset password (owner-only, generates a one-time link).
- "Add staff" form: name, email, phone, role, shift hours, language.

### 2.7 Settings
- Services: CRUD for `services` (name in EN/AR/DE, duration, price, active).
- Integrations: read-only status panel for WhatsApp, Email, Mem0, Langfuse, payments. **No edit form for any of these in M0.** Setting changes happen in `.env` and require a deploy.
- Holidays: CRUD for `holidays`.
- Profile: change own password, language preference.

## 3. The cleaner view (`/cleaner`)

- Header: cleaner's name, "X jobs today, Y tomorrow."
- Today's jobs: vertical list, ordered by time, with the next job expanded.
- Each job card:
  - Time, customer name, address (truncated, tap to expand + open in maps), phone (tap to call / WhatsApp), car (type/color/plate), service, price, payment status badge.
  - Status buttons (one is active at a time):
    - `EN_ROUTE` (sends customer a "your cleaner is on the way" message)
    - `ON_SITE` (sends "we've arrived" message)
    - `IN_PROGRESS`
    - `COMPLETED` (sends thank-you + review request; for CASH bookings, prompts to confirm collection)
    - `NO_SHOW` (requires reason)
- Past jobs: collapsed at the bottom, last 7 days, read-only.
- Pull-to-refresh; Socket.io push for new assignments.

## 4. Public customer status page (`/b/<public_ref>?t=<token>`)

- No login.
- Shows: status timeline (received → confirmed → paid → assigned → on the way → done), cleaner name + photo (optional, M1), payment status, "Reschedule" button (opens a small form), "Cancel" button (with reason).
- Token rotates per booking; on `COMPLETED`, the token is still valid for 30 days for the review page, then expires.

## 5. The login screen

- Email + password.
- "Forgot password" → email reset link (no SMS in M0).
- Three-language toggle in the corner (EN / AR / DE).
- Arabic mode flips to RTL.
- After login, role determines redirect: owner/dispatcher → `/dashboard`; cleaner → `/cleaner`.

## 6. The data-loading contract (no hardcoded state)

Every dashboard card, list, or table calls an API and renders its result. The pattern is mandatory:

```js
async function loadSection(name) {
  setLoading(name, true);
  try {
    const data = await api.get(`/api/${name}`);
    renderSection(name, data);
  } catch (e) {
    renderError(name, e);
  } finally {
    setLoading(name, false);
  }
}
```

- `api.get` uses the JWT from `localStorage` (`hermes.auth.token`).
- On 401 → clear token, redirect to `/login`.
- On 5xx → show a non-modal error with a "Retry" button. **No fake success.**

## 7. Socket.io real-time wiring

| Event | Who emits | Who listens | Effect |
|---|---|---|---|
| `booking:created` | server | dashboard Today, Bookings, Calendar | prepend / insert |
| `booking:updated` | server | dashboard Today, Bookings, Calendar | patch in place |
| `booking:deleted` | server | dashboard Today, Bookings, Calendar | remove |
| `payment:created` | server | dashboard Payments | prepend to pending queue |
| `payment:updated` | server | dashboard Payments | patch |
| `chat:message` | server | dashboard Conversations | append |
| `chat:handoff` | server | dashboard Conversations | flag + notify |
| `cleaner:status` | cleaner app | dashboard Today (right now) | patch |
| `integration:status` | server | dashboard Settings | update chips |

The widget on the landing page is the customer-facing real-time view, not the dashboard. The dashboard is owner-facing.

## 8. UI framework decision

**Decision: migrate `service-agent/public/app.js` from 1,669-line vanilla JS to a small component-based shell.** Hard rules:

1. **No new framework.** The repo's `AGENTS.md` mandates `shadcn/ui + Radix + Tailwind`. Use them. Don't pull in a competing UI lib.
2. **The visual identity stays the same.** Dark glassmorphism, the colors already approved, the typography already approved.
3. **Componentize, don't rewrite.** Each section in `app.js` becomes one component. State management is the smallest thing that works (TanStack Query for server state; component-local state for everything else).
4. **i18n is structural, not bolted on.** Every string lives in `i18n/{en,ar,de}.json`. No English literals in JSX.
5. **The cleaner view is its own bundle.** It's tiny; bundling it with the dashboard slows it down on 3G.
6. **Accessibility baseline:** Radix primitives give keyboard nav; we add `aria-*` attributes and visible focus rings; color contrast ≥ AA.

## 9. What we explicitly are NOT building in the dashboard (M0)

- Drag-to-assign cleaner across multiple bookings (M1).
- Heat map of bookings by area (M1).
- Customer lifetime value charts (M1, after we have ≥ 30 days of data).
- Loyalty / coupons / referral views (Phase 2).
- Marketing analytics (Phase 2).
- Multi-business switcher (we are single-tenant).
- Dark/light theme toggle (dark only in M0; light in M1 if anyone asks twice).

## 10. Acceptance for the dashboard plan

A new operator with no training can, on their first login, in under 5 minutes:
1. See all of today's jobs.
2. Find an unassigned booking and assign a cleaner.
3. Find a pending payment and verify it.
4. Open a customer's conversation, take over, and send a message.
5. Reschedule a booking by dragging it.

The acceptance test is a Playwright E2E that performs all 5 steps and asserts no console errors, no 401s, and the cleaner sees the new assignment in their app.

## 11. Open questions

| # | Question | Owner | Due |
|---|---|---|---|
| Q1 | Do we ship a "review" email/SMS after COMPLETED, or just include the link in the message? | Product | Day 5 |
| Q2 | Calendar: do we want month view in M0, or day/week only? | Frontend | Day 3 |
| Q3 | Is "Take over" visible to the dispatcher, or owner-only? | Product | Day 2 |
| Q4 | Should the public status page show the cleaner's name, or just the company name? | Product (privacy call) | Day 4 |
