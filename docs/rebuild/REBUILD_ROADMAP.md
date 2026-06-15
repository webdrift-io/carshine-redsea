# Clean Rebuild Roadmap — CarShine Red Sea

> Status: **DRAFT v1.0** • Owner: Hermes
> Synthesizes the 12 supporting documents in `docs/rebuild/` into one decision-ready roadmap. This is the document you read in a meeting. The others are what you read before you start coding.

---

## 0. How to read this document

This is the single artifact for the rebuild. Section §17 onwards assigns owners and first tasks. Sections §1–§16 are decisions.

The 12 supporting documents — all under `docs/rebuild/`:

| # | File | Purpose |
|---|---|---|
| 1 | `PRODUCT_VISION.md` | What we are building, what we are not |
| 2 | `MVP_SCOPE.md` | The 10 must-haves + acceptance criteria |
| 3 | `CLEANUP_PLAN.md` | What to keep / fix / archive / delete, in commits |
| 4 | `DATABASE_SCHEMA_PLAN.md` | Tables, migrations, status machines |
| 5 | `AGENT_TOOLS_PLAN.md` | 15 tools the AI can call, with contracts |
| 6 | `DASHBOARD_PLAN.md` | Owner + cleaner + public status pages |
| 7 | `BOOKING_CALENDAR_FLOW.md` | The end-to-end booking swimlane |
| 8 | `PAYMENT_FLOW.md` | Manual InstaPay MVP, honest payment states |
| 9 | `TEST_PLAN.md` | Pyramid, gates, E2E scenarios |
| 10 | `SECURITY_PLAN.md` | Closes the 7 audit findings + adds 10 more |
| 11 | `CI_CD_PLAN.md` | 8-job CI matrix, staging auto, prod gated |
| 12 | `AGENT_TASKS.md` | 2-week sprint plan, owner per task |

---

## 1. Product definition

**One line:** An AI autopilot that runs a real mobile car wash delivery business in El Gouna / Hurghada / Sahl Hasheesh — taking a customer from first WhatsApp message to a paid, assigned, completed wash, with the owner only stepping in when the AI asks for help.

**Three personas:**
- **Customer** — books, gets confirmation, gets washed, gets a thank-you. Doesn't care about our stack.
- **Owner / Dispatcher** — one person running the business from a single dashboard. Sees everything live.
- **Cleaner** — gets a job on their phone, marks status, moves on.

**Three jobs-to-be-done:**
- JTBD-1: "I want my car washed without calling anyone." → channels: web form, chatbot, WhatsApp, email.
- JTBD-3: "I want to run my business without it running me." → one dashboard, AI handles the routine, owner handles the exceptions.
- JTBD-4: "I want to know if I actually got paid." → every booking has a payment record, with a real audit trail.

Full definition: `PRODUCT_VISION.md`.

---

## 2. MVP scope

**The north-star milestone (M0):** *Customer creates a booking → booking appears in dashboard calendar → owner assigns cleaner → payment is verified → customer gets a confirmation.* No human types in WhatsApp during this scenario.

**The 10 must-have features:**

| # | Feature | Owner | Priority |
|---|---|---|---|
| F1 | Owner login & dashboard shell | Codex + MiniMax | P0 |
| F2 | Real booking intake (4 channels → 1 table) | Codex | P0 |
| F3 | Working chatbot (multilingual, tool-first) | MiniMax | P0 |
| F4 | Real, normalized booking database | Codex | P0 |
| F5 | Calendar connected to bookings, assignment-aware | Codex | P0 |
| F6 | Manual InstaPay / payment tracking | Codex + OPS | P0 |
| F7 | Staff / cleaner assignment | Codex + MiniMax | P0 |
| F8 | Customer confirmation & reminder messages | OPS | P0 |
| F9 | Human takeover (owner can intercept any chat) | Codex + MiniMax | P0 |
| F10 | Tests, build, CI | QA + Codex | P0 |

**Should-have (best-effort, M0.x):** receipt storage abstraction, drag-to-assign cleaner, customer self-service status page, cleaner PWA install, cleaner→owner push on status change.

**Out of scope (named so we don't drift):** dynamic pricing, voice agent, real-time GPS, customer-facing native apps, public API, Stripe / international cards. Full scope: `MVP_SCOPE.md`.

---

## 3. What to pause (Phase 2, not Phase 1)

These are explicit deferrals. They do not get Phase 1 estimates. They do not block M0.

- **TikTok auto-publishing** — P2-A.
- **Instagram / Facebook content scheduling** — P2-B.
- **Advanced email drip campaigns** — P2-C.
- **Full marketing autopilot** (Postiz orchestrator, growth analytics) — P2-D.
- **Multi-tenant SaaS** (multiple car wash businesses) — P2-E.
- **Loyalty / referral / coupon system** — P2-F.
- **Mobile native apps** (iOS / Android) — P2-G.

**Hard rule:** if a feature is in P2, it does not appear in a Phase 1 PR. The `tiktok-marketing/` directory and `social_posts` / `social_analytics` tables are paused in M0; they stay untouched until M1+ or are dropped.

---

## 4. What to keep

From the audit's KEEP list, plus my own re-confirmation against the current tree:

| File | Why |
|---|---|
| `service-agent/database.js` | Connection wrapper; we refactor, not rewrite |
| `service-agent/server.js` | Boot, route mounting, Socket.io, startup self-checks; we slim it from 1,356 → < 250 lines |
| `service-agent/agents/orchestrator.js` | Mastra 3-agent pipeline; we extend, don't rewrite |
| `service-agent/agents/tools.js` | Tool layer; we add the 15 tools from `AGENT_TOOLS_PLAN.md` |
| `service-agent/memory/mem0.js` | Customer memory; we wire it into the greeting path |
| `service-agent/observability/langfuse.js` | LLM tracing; we keep dry-run, gate on env |
| `service-agent/public/chatbot-widget.js` | Real widget; we refactor for build-time API base URL + i18n |
| `service-agent/tests/**` | 126 tests; we keep + extend (target: 240+) |
| `service-agent/website-knowledge.js` | Deterministic answer source; we use it in the decision layer |
| `service-agent/agents/decision.js` | Deterministic router; we make it the primary path |
| `service-agent/minimax-agent.js` | Legacy fallback behind `USE_MASTRA_AGENT=false`; remove in M1 |
| `landing-page/` | The Vite source; we make it the **only** landing |
| `service-agent/agents/AGENT_PROMPTS.md` | Source of Mastra prompts; we use as the prompt base |
| `service-agent/migrations/001_create_handoff_tickets.js` | First migration; we add 010..090 next to it |
| `service-agent/schemas/` (when added) | We add it; this is the input-validation source of truth |

---

## 5. What to delete / archive

**Archive (move to `archive/2026-06-pre-rebuild/`, kept 90 days for forensic reference):**
- `service-agent/bookings.json` — test booking, not data.
- `service-agent/calendar.json` — empty legacy JSON.
- `service-agent/chatbot.js` — superseded by orchestrator.
- `service-agent/gemini-chatbot.js` — superseded by orchestrator.
- `service-agent/minimax-agent.js` — keep as a fallback file, but archive a copy of the old version.
- `tiktok-marketing/` — Phase 2.

**Delete (no data, no future use):**
- `service-agent/public/chatbot-demo.html` — pure demo.
- Hardcoded "agent list" in `service-agent/server.js` (the dashboard in-memory state).
- Vite form's "fake local success" fallback in `landing-page/src/features/booking-form.js`.
- The fallback `META_*` env name reads in `server.js` (after a one-release alias period).

**Deprecate (banner, don't delete in M0):**
- Root `index.html` — banner at the top: *"This page is deprecated. See `landing-page/`."*

**`WHY-ARCHIVED.md` template:** every archive directory gets a `WHY-ARCHIVED.md` so a future maintainer doesn't have to dig into git history.

Full plan with commit ordering: `CLEANUP_PLAN.md` §1–§3.

---

## 6. What to rebuild

Per the audit's REBUILD list, plus the rebuild-required items from this plan:

| Surface | Why we rebuild |
|---|---|
| **Payment model** | The audit found `payment` as a free string. We build `payments` + `payment_events` + the manual InstaPay flow. |
| **Customer / vehicle model** | The audit found no `customers` or `vehicles` tables. We normalize them, dedup by phone, support multiple vehicles per customer. |
| **Staff / cleaner assignment** | The audit found no staff concept. We use `users WHERE role IN ('CLEANER','DISPATCHER')` plus an `assignments` table. |
| **Booking lifecycle / status history** | The audit found `bookings.status` as a single state with no audit trail. We add `booking_status_history` (append-only) and a real state machine. |
| **Real WhatsApp delivery inbox** | The audit found WhatsApp code but no delivery records. We add `messages` + `message_events` and webhook signature verification. |
| **Email notification pipeline** | The audit declared email "not actually wired." We add a real `nodemailer` outbound + IMAP inbound (or webhook if provider supports it). |
| **Dashboard as a real operations console** | The audit found hardcoded agent lists and display state. We rebuild around the 7 sections in `DASHBOARD_PLAN.md`, reading exclusively from the DB. |
| **Cleaner view (`/cleaner`)** | The audit found no cleaner UI. We build a separate, phone-first view. |
| **Public status page** | New. The audit's customer has no way to check status without messaging. We add `/b/<ref>?t=<token>`. |
| **Booking intake path unification** | The audit found two landing implementations with broken wiring. We pick `landing-page/` as canonical, fix the form, delete the fake success. |
| **Migration runner** | The audit found `CREATE TABLE` in `database.js`. We move all schemas to `migrations/NNN_*.js`. |

**What we do not rebuild:**
- The Mastra 3-agent pipeline shape. It's right; we extend it.
- The Express + Socket.io + SQLite stack. It's right for our scale.
- The Vite + Three.js / GSAP landing visuals. They work; we leave them alone.
- The project name (CarShine Red Sea) or repo path.

---

## 7. Database schema

**Migration-driven, idempotent, additive in M0.** Files under `service-agent/migrations/`:

```
000_migrations.js              # tracks applied migrations
001_create_handoff_tickets.js  # already exists
010_normalize_identity.js      # users, customers, vehicles
020_services_and_pricing.js    # services (the real catalog)
030_bookings_v2.js             # new bookings table, migrate data
040_payments.js                # payments + append-only payment_events
050_staff_and_assignments.js   # assignments table
060_messages.js                # messages + append-only message_events
070_audit_and_agent_actions.js # booking_status_history, agent_actions, holidays
080_calendar_readonly_view.js  # deprecate calendar_events in M0
090_seed_dev_data.js           # dev-only: 1 owner, 1 dispatcher, 2 cleaners, 4 services
```

**Key decisions:**
- One `users` table for every role (`OWNER` / `DISPATCHER` / `CLEANER`). No separate `staff` table.
- Money is **integer piasters**, never float. Currency is EGP only in M0.
- Timestamps are **ISO-8601 with timezone offset**, rendered in `Africa/Cairo`.
- `payment_events` and `message_events` are **append-only** — DB triggers reject UPDATE / DELETE.
- `bookings.public_ref` is the customer-facing short code (e.g. `CR-20260615-001`).
- Soft delete is the default (`deleted_at`).

**Status machines** (canonical):

```
Booking:
  INTAKE_INCOMPLETE → PENDING_CONFIRMATION → CONFIRMED → PAYMENT_PENDING_REVIEW
                       → PAID → ASSIGNED → EN_ROUTE → ON_SITE → IN_PROGRESS → COMPLETED
       CANCELLED_BY_CUSTOMER | CANCELLED_BY_OWNER | NO_SHOW | ABANDONED (side states)

Payment:
  UNPAID → PENDING_REVIEW → VERIFIED
                    └──→ REJECTED → (back to UNPAID if reopened)
```

**Hard rules:**
- Migrations forward-only in M0. No destructive drops.
- Schema is tested by snapshot comparison (`tests/fixtures/schema.snapshot.sql`).
- Foreign keys enforced (`PRAGMA foreign_keys = ON`).

Full schema with column-by-column spec: `DATABASE_SCHEMA_PLAN.md`.

---

## 8. AI agent tools

**15 tools, one job each, schema-validated, role-checked, rate-limited, audit-logged.**

| Tool | Owner agent | Purpose |
|---|---|---|
| `customer_lookup` | router, intake, booking, handoff | Find a customer by phone/email |
| `customer_upsert` | intake, booking | Create or update a customer |
| `vehicle_upsert` | intake, booking | Save the car |
| `slot_check` | intake, booking | **Source of truth for availability** |
| `booking_create` | booking | Create a real booking (re-checks slot atomically) |
| `booking_get` | intake, booking, handoff | Read a booking (with view permission check) |
| `booking_update_status` | owner/cleaner/AI (restricted sets) | Move the state machine |
| `booking_reschedule` | owner, customer (via token) | Move a booking in time |
| `assign_staff` | owner, dispatcher | Assign a cleaner |
| `payment_record_submission` | customer, owner (CASH) | Customer submits proof |
| `payment_verify` | **owner only** | Verify or reject payment |
| `handoff_to_human` | AI, owner | Open a handoff ticket |
| `handoff_release` | owner | Hand chat back to AI |
| `send_message` | internal (orchestrator only) | Send a templated message |
| `holiday_check` | public | Is this date a holiday? |

**The two non-negotiable rules:**
1. The LLM **never** calls `payment_verify`. Tested with 1,000 simulated conversations.
2. The LLM **never** sets a booking to `COMPLETED`. Tested.

**Deterministic short-circuit:** the `decision.js` layer handles booking, status, opening hours, and pricing without an LLM call when confidence is high. LLM is invoked only when confidence < 0.7. This is what the audit called "active AI is mostly deterministic" — we make the deterministic path **primary**.

**Mem0** wires into `customer_lookup` + the `intake` greeting. Returns by name for returning customers. Egyptian Arabic fixture test asserts a colloquial reply.

**Langfuse** wraps every `orchestrator.generate()` call with a trace tagged by `chatSessionId`, `language`, `channel`, `finalOutcome`, `toolCallCount`, `latencyMs`.

Full tool spec with input/output JSON schemas: `AGENT_TOOLS_PLAN.md`.

---

## 9. Booking + calendar flow

**The end-to-end story (one paragraph):** Customer sends a message on any of the 4 channels. The channel adapter normalizes it to a `chat_session` and a message. The orchestrator runs the deterministic decision first; if it can't answer, the LLM is invoked. The intake agent collects missing fields one at a time in the customer's language. When complete, the booking agent calls `slot_check` (the source of truth for availability) and then `booking_create` (which re-checks atomically inside a transaction). The booking is `CONFIRMED`; the customer gets a `BOOKING_CONFIRMED` message on the same channel they used. 30 seconds later, the system sends `PAYMENT_INSTRUCTIONS` with the InstaPay number, amount, booking ref, and a request for a screenshot or reference. The customer replies with proof. The orchestrator routes to `payment_record_submission`; the booking is `PAYMENT_PENDING_REVIEW`. The owner sees it in the dashboard's Payments section, clicks Approve, the payment becomes `VERIFIED`, the booking becomes `PAID`. The owner clicks "Assign cleaner" on the booking card. The cleaner sees it on their phone, marks `EN_ROUTE` (the customer gets a "your cleaner is on the way" message), then `ON_SITE`, then `IN_PROGRESS`, then `COMPLETED`. The system sends a thank-you and a review request 30 minutes later. The dashboard's "Today" view shows it as done. The owner closes the day.

**Availability algorithm:** max concurrent = `min(2, count(active_cleaners_on_shift))`. Counts overlapping `bookings` for that hour whose `status NOT IN ('CANCELLED_*','ABANDONED','NO_SHOW')`. Returns 3 suggested slots within ±48h when full.

**Calendar is a read model** over `bookings + assignments + users`, not a separate `calendar_events` table. The old `calendar_events` is read-only fallback in M0, dropped in M1.

**Idempotency:** every inbound message gets an `idempotency_key` (provider id or hash). `chat_messages` has `UNIQUE(provider, provider_message_id)`. `POST /api/public/bookings` is idempotent on `(customer_id, scheduled_start, service_id, source='WEB_FORM')` within 5 minutes.

Full swimlane + state diagram: `BOOKING_CALENDAR_FLOW.md`.

---

## 10. Payment / InstaPay manual MVP flow

**The non-negotiable:** the system never claims "paid" without `payments.status = VERIFIED`. No exceptions.

**Configuration, not code:**
```
INSTAPAY_RECEIVING_NUMBER=01XXXXXXXXX
INSTAPAY_RECEIVING_NAME="CarShine Red Sea"
INSTAPAY_QR_IMAGE_URL=https://cdn.carshine.example/instapay-qr.png
INSTAPAY_PAYMENT_LINK=https://instapay.example/pay/...
INSTAPAY_INSTRUCTIONS_EXTRA_{EN,AR,DE}="..."
```

**Customer journey:** `CONFIRMED` → receives `BOOKING_CONFIRMED` → 30s later receives `PAYMENT_INSTRUCTIONS` (EN/AR/DE) → submits proof via WhatsApp (image or text) / email / web form → `payments.status = PENDING_REVIEW`, `bookings.payment_status = PENDING_REVIEW`, customer gets `PAYMENT_SUBMITTED_ACK`.

**Owner reviews** in the dashboard's Payments section. Approve (no reason needed) → `VERIFIED`, `bookings.payment_status = PAID`, customer gets `PAYMENT_VERIFIED`. Reject (reason required, dropdown + free text) → `REJECTED`, `bookings.payment_status = UNPAID`, customer gets `PAYMENT_REJECTED` + a fresh `PAYMENT_INSTRUCTIONS`.

**The AI never auto-verifies.** Regression test runs 1,000 simulated "I paid" messages; the orchestrator's audit shows 0 calls to `payment_verify`.

**Receipts** are stored as opaque URLs (UUID-named files) in `service-agent/storage/receipts/<booking_id>/`. Magic-number sniffing rejects anything that isn't JPEG/PNG/WebP/HEIC. Max 5 MB. Authenticated GET route (owner-only).

**Gateway swap path:** the data model + dashboard do not change when we later replace manual flow with Paymob / Fawry. Only the `payment_record_submission` and `payment_verify` handlers change. The design supports it on purpose.

Full flow with edge cases: `PAYMENT_FLOW.md`.

---

## 11. Dashboard pages

**Five personas, five views:**
- Owner / Dispatcher → `/dashboard` (the seven sections).
- Cleaner → `/cleaner` (separate bundle, phone-first).
- Public customer → `/b/<public_ref>?t=<token>` (no login).
- Anonymous → `/login`.
- Future / system → never (single tenant).

**The seven owner sections:**
1. **Today** (default landing) — right now, up next, needs approval, unassigned, KPIs. No marketing cards.
2. **Calendar** — day/week grid; drag-to-reschedule; holiday gray-outs.
3. **Bookings** — sortable, filterable table; bulk actions.
4. **Conversations** — unified inbox; "Take over" / "Hand back" buttons; right-rail customer context.
5. **Payments** — pending review (default) / verified / all-time totals / CSV export (owner-only).
6. **Staff** — users with role != OWNER; activate/deactivate, shift hours, reset password.
7. **Settings** — services CRUD, integrations status panel (read-only in M0), holidays CRUD, profile.

**The cleaner view** (`/cleaner`): vertical list of today's jobs (next one expanded), tap-to-call/WhatsApp, status buttons (`EN_ROUTE` / `ON_SITE` / `IN_PROGRESS` / `COMPLETED` / `NO_SHOW`).

**The public status page** (`/b/<ref>?t=<token>`): timeline + reschedule + cancel; no login; token rotated per booking; valid 30 days post-COMPLETED for review.

**Hard rule:** no hardcoded data anywhere in the dashboard. Every card, list, and table calls an API and renders the result. No fake success.

**UI framework:** shadcn/ui + Radix + Tailwind (per `AGENTS.md`). No new framework.

**Real-time:** Socket.io events `booking:created/updated/deleted`, `payment:created/updated`, `chat:message`, `chat:handoff`, `cleaner:status`, `integration:status` patch the dashboard in place.

Full section-by-section spec: `DASHBOARD_PLAN.md`.

---

## 12. Staff / cleaner workflow

**Identity:** one `users` table for every role. Cleaners and dispatchers are `users WHERE role IN ('CLEANER','DISPATCHER') AND active = 1 AND deleted_at IS NULL`.

**Assignment:** owner (or dispatcher) clicks "Assign cleaner" on a `PAID` booking → modal with cleaner list filtered by shift coverage for that hour → confirm → `assignments` row created, prior assignment (if any) closed with `released_at` + `release_reason`, `bookings.status` moves to `ASSIGNED`. Cleaner sees the new job in their app within 5 seconds (Socket.io push).

**Cleaner's day:**
1. Open `/cleaner` on their phone. Top: "X jobs today, Y tomorrow."
2. Tap a job to expand: time, customer, address, phone (tap-to-call), car, service, price, payment status.
3. Status buttons (one active at a time):
   - `EN_ROUTE` — system sends customer "your cleaner is on the way" (WhatsApp + email).
   - `ON_SITE` — system sends "we've arrived."
   - `IN_PROGRESS` — no message.
   - `COMPLETED` — system sends thank-you; for CASH bookings, prompts to confirm collection.
   - `NO_SHOW` — reason required.
4. Each transition writes `booking_status_history` and emits `booking:updated` to the owner's dashboard.

**Authorization:** cleaner can only see their own jobs; only the `assignments` table joins to verify. A cleaner cannot transition a booking not assigned to them — returns 403, tested.

**Constraints (Day 4 open question):** 15-minute travel buffer between bookings for the same cleaner? M0: no buffer (simple). M1: yes.

Full flow: `DASHBOARD_PLAN.md` §3, `BOOKING_CALENDAR_FLOW.md` §4.

---

## 13. Tests needed

**Pyramid (target):** 200+ unit, 40+ integration, 12 E2E. Coverage 60% lines, 55% branches, 60% functions.

**Unit (≥ 200):** one file per tool; orchestrator decision-layer tests; migrations test; parsers; templates; state machines (booking, payment); auth; integrations/instapay.

**Integration (≥ 40):** full Express app against in-memory SQLite, no browser, LLM mocked. Cover: public APIs (bookings, chat, inbound webhook), owner APIs (auth, bookings CRUD, payments verify/reject, staff assign), cleaner APIs (jobs, status), Socket.io events, migration runner, seed.

**E2E (12, Playwright, EN + AR + DE):** web form book, chatbot book in AR, chatbot book in DE, owner approve, owner verify payment, owner assign cleaner, cleaner status flow, public status page, take over chat, public reschedule, RTL toggle, **full M0 scenario E2E-12 (the "MVP done" test)**.

**Gates (CI):** lint + typecheck + unit + integration + migrations + coverage + security + E2E + build. **A red PR cannot merge.**

**Smoke:** `scripts/smoke.sh` curls `/health`, `/api/public/services`, `/api/integrations/status`. Runs on every deploy.

**Performance budgets:** `POST /api/public/bookings` p95 < 400ms (no LLM); chat p95 < 1.2s with LLM, < 80ms deterministic; dashboard Today p95 < 600ms with 200 bookings.

Full test plan with fixtures: `TEST_PLAN.md`.

---

## 14. Security requirements

**The 7 audit findings, closed:**

| Finding | Fix |
|---|---|
| F-SEC-1: real `.env` in working tree | `.gitignore` + pre-commit hook + CI grep |
| F-SEC-2: JWT secret falls back to random | Require `JWT_SECRET >= 32` chars; refuse to start otherwise |
| F-SEC-3: localhost auth bypass masks prod | Gated on `NODE_ENV=development` AND `ENABLE_DEV_BYPASS=true`; production refuses to start with bypass |
| F-SEC-4: WhatsApp signature verification skipped | `WHATSAPP_APP_SECRET` required in prod; HMAC-SHA256 verify on `X-Hub-Signature-256` |
| F-SEC-5: env name mismatch | Canonical `WHATSAPP_*`; `META_*` alias shim with `console.warn`; CI grep gate |
| F-SEC-6: npm vulnerabilities | `npm audit --audit-level=high` in CI; Renovate weekly patches |
| F-SEC-7: no normalized audit log | `payment_events` + `booking_status_history` + `agent_actions` (append-only, trigger-enforced) |

**Plus 10 additional controls:**
- Rate limiting (per-IP, per-customer, per-session, per-phone).
- Ajv input validation on every public route.
- SQL prepared statements only; CI grep gate on `.run(` with non-static args.
- HTML escaping; CSP forbids inline scripts.
- bcrypt cost 12; JWT TTLs per role; refresh tokens; `token_revocations` table.
- RBAC: `requireRole` + `requireOwnership` middleware.
- PII redaction in `agent_actions.input` and logs.
- File upload: magic-number sniff, UUID filename, max 5 MB.
- Webhook idempotency: `UNIQUE(provider, provider_message_id)`.
- Dependency hygiene: `npm ci` in CI; no new deps without a justification.

**Pre-deploy security checklist** is a CI gate (`npm run security:check`).

**Compliance posture (M0, lightweight):** GDPR + Egypt PDPL data export + soft delete; explicitly out of PCI scope (no card data); log retention 30/90/1825 days by table.

Full plan with threat model + incident response: `SECURITY_PLAN.md`.

---

## 15. CI / CD requirements

**CI: 8-job matrix on every PR + every push to main.**
1. Lint
2. Typecheck
3. Unit tests + coverage
4. Integration tests
5. Migrations test (fresh DB)
6. Security check
7. E2E (Playwright, Chromium + WebKit)
8. Build

The `build` job depends on all 7. A green PR can merge; a red PR cannot. Branch protection enforces this.

**CD: staging auto, production gated.**
- Merge to `main` → auto-deploy to staging → smoke test → notify owner.
- Owner clicks "Promote to production" in GitHub Environments → deploy → smoke test → tag release (`v20260615-1530`).
- **No auto-deploy to production. Ever.**

**Deploy target (M0):** single VPS, Node 20 under systemd, Caddy reverse proxy + Let's Encrypt, SQLite on disk with nightly backup to S3-compatible. **No Kubernetes in M0.**

**Backup:** nightly `cp database.sqlite backup-$(date).sqlite` + S3 upload; 30 daily / 12 monthly; restore tested monthly.

**Branch protection:** require PR + 1 approval + linear history + status checks; no force pushes; no deletions.

**Renovate:** weekly auto-merge for patch/minor; major PRs get a `breaking` label.

Full plan with workflow YAMLs + runbook stubs: `CI_CD_PLAN.md`.

---

## 16. 2-week task plan

Day-by-day, in `AGENT_TASKS.md`. Summary:

| Days | Focus | Key tasks |
|---|---|---|
| 1–2 | Foundation | T-CX-01…05 (schema, env, build, CI), T-SE-01 (security lockdown), T-OPS-01 (CI matrix) |
| 3–5 | Booking + payments (the M0 milestone) | T-CX-06…10 (15 tools, slot_check, payment_verify, public bookings, owner API), T-MM-01…06 (form, widget, dashboard, cleaner, status page), T-OPS-02/03 (WhatsApp, Email), T-OPS-04 (reminder cron) |
| 6–8 | Quality + security + deploy | T-QA-01/02/03 (tests, E2E, smoke), T-SE-02/03 (close audit findings, rate limiting), T-OPS-05/06 (CD, backup), T-CX-11/12 (cleanup commits, server.js slim), T-MM-07 (Mem0 + Langfuse) |
| 9–10 | Hardening + M0 sign-off | T-QA-04 (E2E-12 in prod), T-SE-04 (pre-launch review), T-CX-13/14 (SHOULD-have items if time) |

Every task is `MUST` / `SHOULD` / `LATER`. Every task has an owner agent (Codex / MiniMax / QA / SEC / OPS) and a reviewer.

---

## 17. Agent assignment

| Agent | Symbol | Owns |
|---|---|---|
| **Codex** | `[CX]` | Backend, DB, migrations, API, auth, payments, jobs, server slim-down |
| **MiniMax** | `[MM]` | Frontend, dashboard, chatbot, prompts, i18n, cleaner view, status page |
| **QA** | `[QA]` | Tests (unit, integration, E2E), coverage gates, smoke scripts, Playwright |
| **SEC (Security)** | `[SE]` | Auth, secrets, env, RBAC, audit logs, dependency audit, `security:check` |
| **OPS (DevOps / Integrations)** | `[OP]` | CI/CD, deploy, WhatsApp, Email, cron, backups |
| **Hermes** | `[HE]` | Orchestration, sprint cadence, M0 sign-off, post-mortem |

**Hard rule:** Codex and MiniMax do not step on each other. The API contract (`service-agent/openapi.yaml`) is the boundary. Codex owns the contract; MiniMax consumes it.

---

## 18. First task for Codex

> **T-CX-02 + T-CX-03 + T-CX-04 (one PR if possible): Migrate the schema to `migrations/` and add the new tables.**
>
> Files: `service-agent/database.js` (slim down), `service-agent/migrations/010…070*.js` (add the 8 new table groups per `DATABASE_SCHEMA_PLAN.md` §4), `service-agent/migrations/090_seed_dev_data.js`, `service-agent/migrations/030_bookings_v2.js` (data migration).
>
> Acceptance: fresh DB runs all migrations to the documented schema; seed runs in dev only; the 126 existing tests still pass; `npm run test:migrations` is green; FK enforcement is on; append-only triggers on `payment_events` and `message_events` reject UPDATE / DELETE; no `CREATE TABLE` remains in `database.js`.
>
> Reviewer: SEC (for FK posture + append-only triggers).

---

## 19. First task for MiniMax

> **T-MM-01 + T-MM-02 (one PR if possible): Fix the booking form wiring and refactor the chatbot widget.**
>
> Files: `landing-page/src/features/booking-form.js`, `service-agent/public/chatbot-widget.js`, `landing-page/i18n/{en,ar,de}.json`, `service-agent/public/i18n/{en,ar,de}.json`, `landing-page/vite.config.*`.
>
> Acceptance: the form posts to `/api/public/bookings` (not `/api/bookings`); no fake success fallback; build-time API base URL (`import.meta.env.VITE_API_BASE_URL`, default `/api`); EN + AR (RTL) + DE; `data-testid` on every input; the chatbot widget renders in 3 languages with the same base-URL rule; CI test asserts that a backend-down form shows the error UI (not fake success).
>
> Reviewer: Codex (for the API contract) + QA.

---

## 20. First task for QA Agent

> **T-QA-01 + T-QA-03: Stand up the test pyramid and the smoke script.**
>
> Files: `service-agent/tests/unit/`, `service-agent/tests/integration/`, `service-agent/tests/helpers/`, `service-agent/vitest.config.js`, `scripts/smoke.sh`.
>
> Acceptance: `npm test` runs unit + integration; coverage report visible; coverage gate at 60% lines is enforced; `scripts/smoke.sh` exits non-zero on a deliberately broken server (e.g. DB file removed); fixtures for the 10 most-common customer messages exist; the test for "AI never calls `payment_verify`" is in place as a regression test.
>
> Reviewer: Hermes.

---

## 21. First task for Security Agent

> **T-SE-01: Lock down env, JWT, and dev bypass.**
>
> Files: `.gitignore` (verify `.env` is ignored; add pre-commit hook), `service-agent/.env.example` (add `JWT_SECRET` placeholder, document `ENABLE_DEV_BYPASS`), `service-agent/auth.js` (require `JWT_SECRET >= 32` chars; refuse to start otherwise), `service-agent/server.js` (gate dev bypass on `NODE_ENV=development` AND `ENABLE_DEV_BYPASS=true`; production asserts `ENABLE_DEV_BYPASS !== 'true'`), `scripts/security-check.js` (the 3 F-SEC checks).
>
> Acceptance: the three F-SEC findings are closed and verifiable by a test or CI gate; `npm run security:check` passes for those three checks; CI fails on a real `.env` accidentally committed; CI fails on a missing `JWT_SECRET`; production refuses to start with `ENABLE_DEV_BYPASS=true`.
>
> Reviewer: Hermes.

---

## Appendix A — The first-task sprint (Day 1)

Five PRs land in parallel, in this order:

1. **Codex** lands the schema migration PR.
2. **MiniMax** lands the form + widget PR (depends on the API contract being stable, which is true — the contract is in `openapi.yaml`).
3. **QA** lands the test pyramid + smoke PR.
4. **Security** lands the env/JWT/bypass lockdown PR.
5. **Ops** lands the CI matrix + branch protection PR.

By end of Day 1, CI is green, the new tables exist, the form wires to the right endpoint, tests run, secrets are locked, and the build chain works. Day 2 starts the feature work — tools, slot_check, payment flow, dashboard.

## Appendix B — Definition of M0 done

The MVP is done when **all 10 must-haves pass their acceptance tests in production**, the owner has run the M0 scenario three times without a human typing in WhatsApp, and CI is green for 5 consecutive days. E2E-12 (the full scenario) is the gate.

## Appendix C — Documents in this rebuild

All under `docs/rebuild/`:

```
PRODUCT_VISION.md
MVP_SCOPE.md
CLEANUP_PLAN.md
DATABASE_SCHEMA_PLAN.md
AGENT_TOOLS_PLAN.md
DASHBOARD_PLAN.md
BOOKING_CALENDAR_FLOW.md
PAYMENT_FLOW.md
TEST_PLAN.md
SECURITY_PLAN.md
CI_CD_PLAN.md
AGENT_TASKS.md
REBUILD_ROADMAP.md     ← this file
```
