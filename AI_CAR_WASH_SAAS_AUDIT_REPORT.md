# AI Car Wash SaaS Audit Report

## 1. Stack Detected

Frontend: Vite landing pages, vanilla JS modules, Three.js, GSAP.

Backend/API: Express 4, Socket.io, plain CommonJS.

Database/ORM: SQLite via `better-sqlite3`; no ORM.

Auth: JWT admin login with bcrypt password hashes. Local development bypass exists for localhost requests.

AI: Current runtime uses Mastra-style multi-agent orchestrator by default. LLM reply text only runs when `ENABLE_LLM_REPLY_TEXT=true` and `OPENAI_API_KEY` exists. Otherwise deterministic rules answer. Legacy files mention MiniMax/Gemini, but MiniMax is not a real active provider in the current default path.

WhatsApp: Meta/Twilio outbound/inbound code exists, but env names are inconsistent. Example env uses `META_ACCESS_TOKEN` / `META_PHONE_NUMBER_ID`; server checks `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`.

Email: Env template mentions SMTP, but no real email sending path was found in the operational backend.

Calendar: SQLite `calendar_events`; created when an admin approves a booking.

Payment: Manual payment only. InstaPay is routing text/number/link/QR config, not a real payment integration. No payment table or paid status.

Deployment/CI: GitHub Actions CI exists at `.github/workflows/ci.yml`, but deploy is artifact packaging only, not real production deployment.

## 2. Project Structure Summary

Main areas:

- `landing-page/`: Vite source landing app.
- `index.html`: separate root landing page with inline booking/chat wiring.
- `service-agent/`: Express backend, dashboard, DB, agents.
- `service-agent/public/`: admin dashboard and chatbot widget.
- `service-agent/agents/`: multi-agent orchestrator/tools.
- `tiktok-marketing/`: marketing/social side area.

Git status: no commits yet; everything is untracked on `master`.

## 3. Commands Run and Results

- `npm install` root: success; 2 vulnerabilities.
- `npm install` `landing-page`: success; 3 vulnerabilities.
- `npm install` `service-agent`: success; 2 low vulnerabilities.
- Root `npm run lint/typecheck/test`: missing scripts.
- Root `npm run build`: failed because root `package.json` calls `node ../build-landing.cjs`, resolving outside the repo.
- `service-agent npm run lint`: passed with 21 warnings.
- `service-agent npm run typecheck`: passed.
- `service-agent npm test`: passed, 6 files / 126 tests.
- `service-agent npm run build`: missing script.
- `landing-page npm run lint/typecheck/test`: missing scripts.
- `landing-page npm run build`: passed, with large Three.js chunk warnings.
- Runtime smoke: started service, `/health` returned OK with `aiProvider: mastra-multi-agent`.
- Runtime public chat: answered successfully.
- Runtime public booking: created a pending booking successfully; audit test booking/chat were cleaned afterward.

## 4. What Is Working

- Backend boots.
- SQLite schema initializes.
- Admin dashboard exists.
- Public chat endpoint works when backend is running.
- Public booking endpoint `/api/public/bookings` can create pending bookings.
- Slot capacity check exists: 09:00-17:00, max 2 bookings per hour.
- Admin approve creates a calendar event.
- Admin reject removes calendar event.
- Chat messages are persisted.
- Mastra tool layer exists for lookup, slot check, booking creation, handoff.
- Handoff ticket migration exists.
- Langfuse dry-run tracing exists.
- Mem0 dry-run lookup from booking history exists.
- Tests pass.

## 5. What Is Broken

- Root `npm run build` is misconfigured.
- The Vite source booking form posts to `/api/bookings`, which is admin-protected outside local dev, and sends wrong field names.
- That same Vite booking form returns mock success if API fails, making failures invisible.
- There are duplicate landing implementations: root `index.html` and `landing-page/index.*.html` / `src`.
- WhatsApp env names do not match between `.env.example` and server integration checks.
- Email is declared but not actually wired.
- Payment is not operationally modeled.
- Staff/cleaner assignment does not exist.
- Customer records are not normalized.
- Calendar is a confirmation artifact, not a real scheduling system.
- Dashboard agents are largely hardcoded display state.

## 6. What Is Fake/Demo/Mock

Clearly demo/mock:

- `service-agent/bookings.json` contains a test booking.
- `service-agent/calendar.json` is empty legacy JSON storage.
- `service-agent/public/chatbot-demo.html` is demo-only.
- Hardcoded dashboard agent list in `server.js` is not real worker orchestration.
- Social analytics endpoint explicitly says analytics are not connected.
- InstaPay is instruction text only.
- Vite form fallback creates fake local success.
- Root landing testimonials/marketing content are static marketing copy, not customer data.

## 7. Chatbot Diagnosis

Real pieces:

- Widget: `service-agent/public/chatbot-widget.js`
- Public endpoint: `/api/public/chat` in `service-agent/server.js`
- Orchestrator: `service-agent/agents/orchestrator.js`
- Tools: `service-agent/agents/tools.js`

Runtime result: Chat answered successfully when backend was running.

Why user may see "not answering": The service was not running on `localhost:5000` before audit startup. Also, widget default API URL is `http://localhost:5000`, which fails on production unless initialized with the deployed origin/API URL.

Can it create booking? Yes, through deterministic collection plus `createBooking`, but only after required fields are collected. It saves chats/messages.

Weakness: The active AI is mostly deterministic unless `ENABLE_LLM_REPLY_TEXT=true` and `OPENAI_API_KEY` are configured. MiniMax branding is misleading.

## 8. Booking Form Diagnosis

There are two paths:

- Root `index.html` posts to `/api/public/bookings`; smoke test passed.
- Vite source `landing-page/src/features/booking-form.js` posts to `http://localhost:5000/api/bookings`, sends `name/car/date/time/payment`, and catches failures as fake success.

Backend public booking creates `bookings.status = pending`; no customer table, no calendar event yet, no payment status.

Dashboard updates: Backend broadcasts `booking:created` and `bookings`.

## 9. Calendar Diagnosis

Calendar exists, but only as `calendar_events`.

Linkage: Booking becomes calendar event only on admin approve.

Availability: Uses booking count by date/hour, max 2. It does not consider cleaners, travel time, area routing, service duration, holidays, or per-staff availability.

Timezone: No explicit Egypt timezone model. Dates/times are stored as strings and ISO snippets.

Conflict prevention: Partial only. Slot check exists before booking, but manual `/api/calendar` insert has weaker validation.

## 10. Payment/InstaPay Diagnosis

Current payment code: Payment method is a string on booking. InstaPay instructions appear in UI and notes. Integration status exposes receiving number/link/QR config.

Real or fake: Manual only. No real payment provider, no webhook, no transaction id, no receipt upload, no payment verification workflow.

Credentials: Optional `INSTAPAY_PAYMENT_LINK`, `INSTAPAY_QR_IMAGE_URL`, receiving number. No official InstaPay API is used.

Can booking become PAID? No. There is no `paid` booking status and no `payments` table.

Safest MVP: Manual payment proof. Customer uploads or sends screenshot, admin marks payment as `submitted`, `verified`, or `rejected`, with `reference`, `amount`, `method`, `verifiedBy`, and `verifiedAt`.

## 11. Dashboard/Login Diagnosis

Exists: Admin dashboard and login gate exist in `service-agent/public/app.js`.

Protected routes: Backend protects `/api/*` except public/webhook/login. Local dev bypass allows localhost without JWT.

RBAC: Only basic admin role; no real multi-user roles.

Data source: Bookings/chats/calendar come from DB. Agent list is hardcoded memory state. Dashboard cards are a mix of real DB aggregation and display state.

Owner control: Approve/reject bookings, autopilot toggle, agent toggle, chat message sending.

Missing: Cleaner assignment, payment verification, message inbox tied to real WhatsApp delivery state, staff operations.

## 12. Database Diagnosis

Existing tables from source:

- `bookings`
- `calendar_events`
- `chat_sessions`
- `chat_messages`
- `admin_credentials`
- `social_posts`
- `social_analytics`
- `handoff_tickets` via migration

Missing for real MVP:

- `users`
- `customers`
- `vehicles`
- `services`
- `booking_status_history`
- `agent_actions`
- `staff` / `cleaners`
- `assignments`
- `payments`
- `payment_events`
- `receipt_uploads`
- normalized `conversations` and provider message delivery records

## 13. Security Risks

- Real `service-agent/.env` exists locally; audit did not print it.
- JWT secret falls back to random per boot if missing, invalidating sessions and hiding config mistakes.
- Localhost auth bypass can mask production auth failures.
- WhatsApp signature verification is skipped in non-production when secret missing.
- Env variable naming mismatch may leave WhatsApp "configured" in `.env` but disconnected in code.
- npm audit reports vulnerabilities in root/landing/service packages.
- No normalized audit log for admin approval/payment actions.

## 14. KEEP / FIX / DELETE_OR_ARCHIVE / REBUILD

KEEP:

- `service-agent/database.js`
- `service-agent/server.js`, after cleanup
- `service-agent/agents/orchestrator.js`
- `service-agent/agents/tools.js`
- `service-agent/memory/mem0.js`
- `service-agent/observability/langfuse.js`
- `service-agent/public/chatbot-widget.js`
- tests under `service-agent/tests`

FIX:

- `landing-page/src/features/booking-form.js`
- root `package.json` build script
- WhatsApp env naming in `.env.example` vs `server.js`
- dashboard hardcoded operational text
- calendar validation/manual insert path
- auth/dev bypass clarity
- CI build commands

DELETE_OR_ARCHIVE:

- `service-agent/bookings.json`
- `service-agent/calendar.json`
- `service-agent/public/chatbot-demo.html`
- legacy duplicate chatbot/agent files if no longer used: `chatbot.js`, `gemini-chatbot.js`, possibly `minimax-agent.js`
- duplicate/conflicting landing implementation after choosing one source of truth

REBUILD:

- payment model
- customer/vehicle model
- staff/cleaner assignment
- booking lifecycle/status history
- real WhatsApp delivery inbox
- email notification pipeline
- dashboard as real operations console

## 15. Root Cause

The app feels like a demo because it has many visible surfaces, but the operational domain model is too thin. Bookings are single rows, payments are strings, calendar events are approval artifacts, staff do not exist, and several integrations are represented by UI/config text rather than durable workflows.

First real blocker: Choose one source of truth for landing booking/chat and wire it to the public backend endpoints.

Why chatbot is not answering: Locally, the backend was not running. In production-like use, the widget's default `localhost:5000` API URL will also fail unless configured.

Why booking/calendar/payment are not connected: Booking creates pending rows. Calendar only appears after approval. Payment has no table/status. There is no workflow tying payment verification, assignment, and booking confirmation together.

What to fix first: Booking intake path, because every other workflow depends on reliable booking records.

## 16. Recommended Clean Rebuild Order

1. Single source of truth for website booking/chat.
2. Normalize DB: customers, vehicles, services, bookings, status history.
3. Add payment/manual proof model.
4. Add staff/cleaner assignment model.
5. Replace calendar with availability + assignment-aware scheduling.
6. Fix WhatsApp envs and delivery records.
7. Add email notifications.
8. Refresh dashboard around real operations.
9. Add Playwright E2E for EN/AR/DE.
10. Archive demo/legacy files.

## 17. First 10 Tasks

1. Decide root landing vs `landing-page` as canonical.
2. Fix booking form to call `/api/public/bookings`.
3. Remove fake success fallback from booking form.
4. Add `customers` and `vehicles` tables via migration.
5. Add `payments` table and manual proof statuses.
6. Add booking status history.
7. Add staff/cleaner and assignments tables.
8. Fix WhatsApp env names and integration status checks.
9. Add E2E tests for booking/chat/calendar approval.
10. Archive demo JSON/demo chatbot files.

## 18. Which Agent Should Handle Each Task

- Backend agent: DB migrations, booking lifecycle, payments, staff assignment.
- Frontend agent: landing booking/chat wiring and dashboard UI.
- AI agent agent: chatbot orchestration, tool calls, returning customer memory.
- Integrations agent: WhatsApp, email, payment-proof routing.
- QA agent: Playwright EN/AR/DE tests and smoke checks.
- Security agent: env, auth, audit logs, dependency audit.
