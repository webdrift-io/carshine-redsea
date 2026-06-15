# Agent Tasks — 2-Week Plan

> Status: **DRAFT v1.0** • Owner: Hermes (orchestrator)
> Concrete, owner-assigned, prioritized tasks for the 2-week M0 sprint. Every task has an acceptance test and a reviewer.

---

## 0. The team (the agents)

We have 5 specialist agents, mapped from the routing rules in `SOUL.md`:

| Agent | Symbol | Specialization | Stack | When to use |
|---|---|---|---|---|
| **Codex** | `[CX]` | Coding Engineer (backend, DB, infra) | Node/Express/SQLite/Socket.io, migrations, CI | DB, API, auth, payments, jobs |
| **MiniMax** | `[MM]` | Frontend + AI agent (UI, chatbot, prompts) | Vite/JS, dashboard, Mastra, i18n | Landing, dashboard, chatbot, prompts |
| **QA** | `[QA]` | Test engineer (unit, integration, E2E) | Vitest, supertest, Playwright | Tests, coverage, E2E, smoke |
| **SEC** | `[SE]` | Security engineer (auth, secrets, audit) | bcrypt, JWT, OWASP, CSP, npm audit | Auth, secrets, deps, audit logs |
| **OPS** | `[OP]` | DevOps / Integrations (CI/CD, WhatsApp, SMTP) | GitHub Actions, systemd/Caddy, Meta Cloud API, SMTP | Deploy, providers, cron, backups |

**Conventions used below:**
- `MUST` = blocks M0 (the milestone defined in `MVP_SCOPE.md` §1).
- `SHOULD` = ship in M0 if time allows, M1 otherwise.
- `LATER` = M1 or Phase 2, not in this sprint.
- `[MUST][CX] T-CX-01` = task ID, owner, priority.
- Every task lists: **Goal**, **Files**, **Acceptance**, **Reviewer**, **Estimate**.

---

## 1. Day 1–2: Foundation (lock the foundation before any feature work)

### T-CX-01 `[MUST]` — Decide landing canonical
- **Goal:** pick `landing-page/` as canonical; add banner to root `index.html`; deprecate root.
- **Files:** `index.html`, `docs/rebuild/CLEANUP_PLAN.md` §2.
- **Acceptance:** root `index.html` shows deprecation banner. No code path imports from it. Build script does not reference it.
- **Reviewer:** Hermes.
- **Estimate:** 30 min.

### T-CX-02 `[MUST]` — Move DB schemas to `migrations/`
- **Goal:** `service-agent/database.js` becomes a thin connection wrapper; all `CREATE TABLE` move to `migrations/`.
- **Files:** `service-agent/database.js`, `service-agent/migrations/010_normalize_identity.js` (and friends per `DATABASE_SCHEMA_PLAN.md` §2).
- **Acceptance:** `npm run test:migrations` passes. `git grep "CREATE TABLE" -- service-agent/database.js` returns nothing. Bootstrapping a fresh DB runs all migrations to the documented schema.
- **Reviewer:** SEC (for FK + soft-delete posture).
- **Estimate:** 4h.

### T-CX-03 `[MUST]` — Apply `migrations/010_normalize_identity.js` … `070_audit_and_agent_actions.js`
- **Goal:** ship all the new tables in `DATABASE_SCHEMA_PLAN.md` §4 in one PR.
- **Files:** `service-agent/migrations/010…070*.js`, `service-agent/migrations/090_seed_dev_data.js`.
- **Acceptance:** fresh DB runs all migrations, then seed, then a smoke query against every new table succeeds. FK enforcement is on. Append-only triggers on `payment_events` and `message_events` reject UPDATE/DELETE.
- **Reviewer:** SEC.
- **Estimate:** 8h.

### T-CX-04 `[MUST]` — Migrate existing `bookings` → new `bookings` v2
- **Goal:** data migration in `030_bookings_v2.js`; old table read-only.
- **Files:** `service-agent/migrations/030_bookings_v2.js`, `service-agent/database.js`.
- **Acceptance:** all 126 existing tests still pass. The audit's "test booking" is migrated to a `MISC` service. No data loss.
- **Reviewer:** QA.
- **Estimate:** 4h.

### T-CX-05 `[MUST]` — Fix root `package.json` build chain
- **Goal:** `npm run build` works at the root.
- **Files:** `package.json` (root), `landing-page/package.json`, `service-agent/package.json`.
- **Acceptance:** `npm run build` from root succeeds. `npm run dev` boots both packages. CI's `build` job passes.
- **Reviewer:** OPS.
- **Estimate:** 1h.

### T-SE-01 `[MUST]` — Lock down `.env`, JWT secret, dev bypass
- **Goal:** close F-SEC-1, F-SEC-2, F-SEC-3.
- **Files:** `.gitignore`, `service-agent/.env.example`, `service-agent/auth.js`, `service-agent/server.js`.
- **Acceptance:** see `SECURITY_PLAN.md` §2 items 1–3. `npm run security:check` passes for these checks.
- **Reviewer:** Hermes.
- **Estimate:** 2h.

### T-OPS-01 `[MUST]` — CI matrix + branch protection
- **Goal:** `.github/workflows/ci.yml` runs the 8-job matrix; branch protection enforces it.
- **Files:** `.github/workflows/ci.yml`, GitHub settings.
- **Acceptance:** a PR with a failing test cannot be merged. A green PR can.
- **Reviewer:** Hermes.
- **Estimate:** 3h.

---

## 2. Day 3–5: Booking + payments (the M0 milestone)

### T-CX-06 `[MUST]` — New agent tools (15 tools in `AGENT_TOOLS_PLAN.md` §2)
- **Goal:** implement every tool with input/output schema, role check, rate limit, audit.
- **Files:** `service-agent/agents/tools.js`, `service-agent/agents/schemas/*.json`.
- **Acceptance:** all 15 tools registered. `npm run test:unit` has ≥ 60 tests covering the tools. Tool validation pipeline (`AGENT_TOOLS_PLAN.md` §4) wired in.
- **Reviewer:** QA + SEC.
- **Estimate:** 12h.

### T-CX-07 `[MUST]` — `slot_check` correctness
- **Goal:** the algorithm in `BOOKING_CALENDAR_FLOW.md` §3 is implemented and tested.
- **Files:** `service-agent/agents/tools.js`, `service-agent/tests/integration/slot-check.test.js`.
- **Acceptance:** 10 fixture cases pass (holiday, past time, full hour, partial overlap, cleaner busy, suggested slots, etc.).
- **Reviewer:** QA.
- **Estimate:** 4h.

### T-CX-08 `[MUST]` — `payment_record_submission` + `payment_verify` (the "AI never verifies" gate)
- **Goal:** manual InstaPay flow end-to-end.
- **Files:** `service-agent/agents/tools.js`, `service-agent/routes/public.js`, `service-agent/routes/admin.js`, `service-agent/integrations/instapay.js`.
- **Acceptance:** see `PAYMENT_FLOW.md` §9. AI never calls `payment_verify` (regression test).
- **Reviewer:** SEC.
- **Estimate:** 6h.

### T-CX-09 `[MUST]` — Public booking intake (`/api/public/bookings`)
- **Goal:** the four channels funnel into one orchestrator; the form posts here; idempotency works.
- **Files:** `service-agent/server.js`, `service-agent/routes/public.js`, `landing-page/src/features/booking-form.js`.
- **Acceptance:** the form posts to `/api/public/bookings`. No fake success. Idempotency test (same key twice → same `public_ref`) passes.
- **Reviewer:** MiniMax (for the form) + QA.
- **Estimate:** 4h.

### T-MM-01 `[MUST]` — Fix booking form wiring + i18n
- **Goal:** the form is the real entry point; EN + AR + DE; uses build-time API base URL.
- **Files:** `landing-page/src/features/booking-form.js`, `landing-page/i18n/{en,ar,de}.json`, `landing-page/vite.config.*`.
- **Acceptance:** see `CLEANUP_PLAN.md` §4. `data-testid` on every input. CI test asserts no fake success path.
- **Reviewer:** Codex (for the API contract) + QA.
- **Estimate:** 4h.

### T-MM-02 `[MUST]` — Chatbot widget refactor
- **Goal:** build-time API base URL; EN + AR (RTL) + DE.
- **Files:** `service-agent/public/chatbot-widget.js`, `service-agent/public/index.html`.
- **Acceptance:** the widget renders in 3 languages. The default base URL is `window.location.origin + '/api'`, not hardcoded localhost. `data-testid` hooks for E2E.
- **Reviewer:** QA.
- **Estimate:** 3h.

### T-MM-03 `[MUST]` — Orchestrator deterministic path covers 80% of intents
- **Goal:** booking, status check, opening hours, payment instructions all deterministic; LLM only as backstop.
- **Files:** `service-agent/agents/decision.js`, `service-agent/agents/orchestrator.js`, `service-agent/website-knowledge.js`.
- **Acceptance:** 100 simulated customer messages; ≥ 80 hit the deterministic path (0 LLM tokens). Egyptian Arabic fixtures produce colloquial replies (`يا فندم`, `منورنا`).
- **Reviewer:** Codex.
- **Estimate:** 6h.

### T-OPS-02 `[MUST]` — WhatsApp inbound + outbound
- **Goal:** real Meta Cloud API integration; signature verification; idempotency.
- **Files:** `service-agent/integrations/whatsapp.js`, `service-agent/routes/public.js`.
- **Acceptance:** see `SECURITY_PLAN.md` F-SEC-4. Webhook signature verified. Inbound creates a chat session; outbound uses template. E2E test sends a stub webhook, asserts routing.
- **Reviewer:** SEC.
- **Estimate:** 6h.

### T-OPS-03 `[MUST]` — Email inbound + outbound (SMTP)
- **Goal:** real SMTP integration via `nodemailer`; templated outbound; IMAP polling for inbound (or webhook if provider supports it).
- **Files:** `service-agent/integrations/email.js`.
- **Acceptance:** a real send to a Mailtrap inbox arrives with the rendered template. Inbound email with subject `BOOK:` creates a chat session.
- **Reviewer:** SEC (for SMTP credentials handling).
- **Estimate:** 4h.

### T-CX-10 `[MUST]` — Owner auth + dashboard API surface
- **Goal:** `/api/auth/login`, `/api/admin/*` (role-gated), `/api/cleaner/*` (role + ownership).
- **Files:** `service-agent/server.js`, `service-agent/routes/{auth,admin,cleaner}.js`, `service-agent/auth.js`.
- **Acceptance:** integration tests cover the auth matrix in `TEST_PLAN.md` §4.2–4.3.
- **Reviewer:** SEC.
- **Estimate:** 6h.

### T-MM-04 `[MUST]` — Dashboard sections: Today, Bookings, Calendar, Payments, Conversations, Staff, Settings
- **Goal:** real DB-backed UI; no hardcoded agent list; EN + AR (RTL) + DE.
- **Files:** `service-agent/public/app.js` (refactored into components), `service-agent/public/i18n/{en,ar,de}.json`.
- **Acceptance:** see `DASHBOARD_PLAN.md` §2 + §10. The 5-minute-new-operator test passes.
- **Reviewer:** QA.
- **Estimate:** 16h.

### T-MM-05 `[MUST]` — Cleaner view (`/cleaner`)
- **Goal:** separate SPA-like view; phone-first; status update buttons.
- **Files:** `service-agent/public/cleaner.js`, `service-agent/public/cleaner.html`.
- **Acceptance:** see `DASHBOARD_PLAN.md` §3. E2E-07 (cleaner status update) passes.
- **Reviewer:** QA.
- **Estimate:** 6h.

### T-MM-06 `[MUST]` — Public status page (`/b/<ref>?t=<token>`)
- **Goal:** no-login customer view; timeline; cancel; reschedule.
- **Files:** `service-agent/public/status.html`, `service-agent/public/status.js`.
- **Acceptance:** E2E-08 + E2E-10 pass. Token verification rejects unauthenticated access.
- **Reviewer:** SEC.
- **Estimate:** 4h.

### T-OPS-04 `[MUST]` — Reminder cron + nightly jobs
- **Goal:** `reminder24h` daily at 09:00 + 14:00; `abandonStaleIntake` nightly; `purgeOldReceipts` nightly.
- **Files:** `service-agent/jobs/*.js`, `service-agent/server.js` (boot the scheduler).
- **Acceptance:** integration test: insert a `CONFIRMED` booking for tomorrow, run the job, assert `messages` row with `template_code = 'REMINDER_24H'`.
- **Reviewer:** QA.
- **Estimate:** 3h.

---

## 3. Day 6–8: Quality, security, deploy

### T-QA-01 `[MUST]` — Unit + integration tests reach the bar
- **Goal:** ≥ 200 unit tests, ≥ 40 integration tests; coverage 60% lines, 55% branches.
- **Files:** `service-agent/tests/unit/`, `service-agent/tests/integration/`, `service-agent/vitest.config.js`.
- **Acceptance:** CI gates pass. `npm run test:coverage` shows the numbers.
- **Reviewer:** Hermes.
- **Estimate:** 12h.

### T-QA-02 `[MUST]` — Playwright E2E suite
- **Goal:** 12 E2E tests in `TEST_PLAN.md` §5.1; green on Chromium.
- **Files:** `e2e/`, `playwright.config.ts`.
- **Acceptance:** `npm run test:e2e` green. E2E-12 (full scenario) is the MVP-done gate.
- **Reviewer:** Hermes.
- **Estimate:** 12h.

### T-QA-03 `[MUST]` — Smoke test script
- **Goal:** `scripts/smoke.sh` curls `/health`, `/api/public/services`, `/api/integrations/status`.
- **Files:** `scripts/smoke.sh`.
- **Acceptance:** returns non-zero on any failure; runs in CI on every deploy.
- **Reviewer:** OPS.
- **Estimate:** 1h.

### T-SE-02 `[MUST]` — Close remaining security findings
- **Goal:** F-SEC-4 (WhatsApp signature), F-SEC-5 (env names), F-SEC-6 (npm audit), F-SEC-7 (audit log).
- **Files:** `service-agent/integrations/whatsapp.js`, `.env.example`, `service-agent/server.js`, `service-agent/routes/admin.js`, `service-agent/agents/tools.js`, `scripts/security-check.js`.
- **Acceptance:** all 7 audit findings closed. `npm run security:check` green. `npm audit --audit-level=high` clean.
- **Reviewer:** Hermes.
- **Estimate:** 6h.

### T-SE-03 `[MUST]` — Rate limiting + input validation
- **Goal:** see `SECURITY_PLAN.md` §3 S-1 + S-2.
- **Files:** `service-agent/server.js`, `service-agent/schemas/*.json`, `service-agent/middleware/{rateLimit,validate}.js`.
- **Acceptance:** integration tests cover the rate limits (each per-IP, per-customer, per-chat, per-phone).
- **Reviewer:** QA.
- **Estimate:** 3h.

### T-OPS-05 `[MUST]` — CD: staging + production with manual gate
- **Goal:** see `CI_CD_PLAN.md` §4.
- **Files:** `.github/workflows/deploy.yml`, `scripts/{deploy,smoke}.sh`, GitHub env settings.
- **Acceptance:** merging to `main` deploys to staging. Manual approval deploys to production. Tag is created.
- **Reviewer:** Hermes.
- **Estimate:** 4h.

### T-OPS-06 `[MUST]` — Backup + restore runbook
- **Goal:** nightly SQLite backup; restore tested once before M0.
- **Files:** `scripts/backup.sh`, `docs/runbooks/backup-restore.md`.
- **Acceptance:** restore test: delete the live DB, restore from backup, app boots, count rows, pass.
- **Reviewer:** Hermes.
- **Estimate:** 2h.

### T-CX-11 `[MUST]` — Cleanup commit chain
- **Goal:** execute the 14-commit cleanup chain in `CLEANUP_PLAN.md` §12.
- **Files:** all of them.
- **Acceptance:** every commit is small, reviewable, and CI-green. `git log --oneline | grep ^c` shows them in order.
- **Reviewer:** Hermes.
- **Estimate:** 6h (mostly review-driven).

### T-MM-07 `[MUST]` — Mem0 + Langfuse wiring
- **Goal:** returning customers get greeted by name; every orchestrator call is traced.
- **Files:** `service-agent/memory/mem0.js`, `service-agent/observability/langfuse.js`, `service-agent/agents/orchestrator.js`.
- **Acceptance:** fixture test asserts greeting with name. Langfuse trace shape matches `AGENT_TOOLS_PLAN.md` §7.
- **Reviewer:** Codex.
- **Estimate:** 3h.

### T-CX-12 `[MUST]` — `server.js` slim-down
- **Goal:** < 250 lines. Routes extracted.
- **Files:** `service-agent/server.js`, `service-agent/routes/*.js`.
- **Acceptance:** `wc -l service-agent/server.js` < 250. All routes work as before.
- **Reviewer:** QA.
- **Estimate:** 3h.

---

## 4. Day 9–10: Hardening + M0 sign-off

### T-QA-04 `[MUST]` — Full scenario E2E-12 in production
- **Goal:** the M0 "done" scenario plays out end-to-end in production.
- **Files:** `e2e/full-scenario.spec.ts` (already written in T-QA-02), `docs/runbooks/m0-signoff.md`.
- **Acceptance:** owner runs the scenario 3 times without a human typing in WhatsApp. CI is green for 5 consecutive days.
- **Reviewer:** Hermes + Owner.
- **Estimate:** 4h (mostly observation).

### T-SE-04 `[MUST]` — Pre-launch security review
- **Goal:** sign off on the 7 audit findings + the additional controls.
- **Files:** `docs/rebuild/SECURITY_PLAN.md`, `scripts/security-check.js`.
- **Acceptance:** signed-off checklist appended to `SECURITY_PLAN.md` with date + reviewer initials.
- **Reviewer:** Hermes.
- **Estimate:** 2h.

### T-CX-13 `[SHOULD]` — Receipt storage abstraction
- **Goal:** `storage.js` interface; local-disk driver in M0; S3 driver stub for M1.
- **Files:** `service-agent/storage.js`, `service-agent/storage/{local,s3}.js`.
- **Acceptance:** receipt upload uses the interface. Swapping drivers is a 1-line change.
- **Reviewer:** QA.
- **Estimate:** 2h.

### T-CX-14 `[SHOULD]` — Idempotency middleware
- **Goal:** generic `idempotency-key` middleware on `/api/public/*` and webhooks.
- **Files:** `service-agent/middleware/idempotency.js`.
- **Acceptance:** two POSTs with the same key return the same `public_ref`.
- **Reviewer:** QA.
- **Estimate:** 2h.

### T-MM-08 `[SHOULD]` — Drag-to-reschedule on calendar
- **Goal:** see `BOOKING_CALENDAR_FLOW.md` §6.
- **Files:** `service-agent/public/components/Calendar.js`.
- **Acceptance:** E2E covers the move; rejection when target slot is full.
- **Reviewer:** QA.
- **Estimate:** 3h.

### T-MM-09 `[LATER]` — Customer self-service review page
- **Goal:** after `COMPLETED`, the public status page shows a 1–5 rating form.
- **Files:** `service-agent/public/status.js`, `service-agent/database.js` (add `reviews` table in M1).
- **Acceptance:** not in M0. Designed-for-M1, scheduled in M1 plan.

### T-OPS-07 `[LATER]` — Multi-cleaner auto-assignment
- **Goal:** the system picks the best cleaner based on shift + last job location.
- **Files:** `service-agent/agents/tools.js` (new tool `auto_assign_staff`).
- **Acceptance:** M1, not M0.

### T-OPS-08 `[LATER]` — Real payment gateway swap
- **Goal:** replace `payment_record_submission` + `payment_verify` with a Paymob/Fawry flow.
- **Files:** `service-agent/integrations/payments/{paymob,fawry}.js`.
- **Acceptance:** M1+. The data model doesn't change.

---

## 5. Tasks deferred to Phase 2 (named so we don't drift)

- **T-P2-01 [LATER]** TikTok auto-publishing.
- **T-P2-02 [LATER]** Instagram / Facebook content scheduling.
- **T-P2-03 [LATER]** Advanced email drip campaigns.
- **T-P2-04 [LATER]** Full marketing autopilot (Postiz orchestrator, growth analytics).
- **T-P2-05 [LATER]** Multi-tenant SaaS.
- **T-P2-06 [LATER]** Loyalty / referral / coupon system.
- **T-P2-07 [LATER]** Mobile native apps (iOS / Android).

These do not get a Phase 1 estimate. If someone proposes one, point them to this list and `MVP_SCOPE.md` §5.

---

## 6. The four first tasks (for the four agents)

These are the very first PRs to land, in order. They unblock everything else.

### 6.1 First task for **Codex** (T-CX-02/03/04 combined into one PR if possible)
> **Migrate the schema to `migrations/` and add the new tables in one PR.**
> Files: `service-agent/database.js` (slim down), `service-agent/migrations/010…070*.js` (add tables per `DATABASE_SCHEMA_PLAN.md` §4), `service-agent/migrations/090_seed_dev_data.js`. Acceptance: fresh DB runs all migrations, seed runs in dev, 126 existing tests still pass, `npm run test:migrations` is green.

### 6.2 First task for **MiniMax** (T-MM-01 + T-MM-02)
> **Fix the booking form and refactor the chatbot widget.**
> Files: `landing-page/src/features/booking-form.js`, `service-agent/public/chatbot-widget.js`, both with EN + AR (RTL) + DE. Acceptance: form posts to `/api/public/bookings`, no fake success, build-time API base URL, `data-testid` on every input.

### 6.3 First task for **QA** (T-QA-01 + T-QA-03)
> **Stand up the test pyramid and the smoke script.**
> Files: `service-agent/tests/`, `scripts/smoke.sh`, `service-agent/vitest.config.js`. Acceptance: `npm test` runs unit + integration, coverage visible, smoke script exits non-zero on a deliberately broken server.

### 6.4 First task for **Security** (T-SE-01)
> **Lock down env, JWT, and dev bypass.**
> Files: `.gitignore`, `service-agent/.env.example`, `service-agent/auth.js`, `service-agent/server.js`, `scripts/security-check.js`. Acceptance: the three F-SEC findings are closed; `npm run security:check` passes for them.

### 6.5 First task for **Ops** (T-OPS-01)
> **CI matrix + branch protection.**
> Files: `.github/workflows/ci.yml`, GitHub settings. Acceptance: a deliberately broken PR cannot be merged; a clean PR can.

---

## 7. Sprint cadence (the heartbeat)

- **Daily standup (async):** each agent posts a 3-line update in `#agents`: yesterday, today, blockers.
- **Mid-sprint demo (Day 5):** show the booking intake + payment flow on staging.
- **M0 sign-off (Day 10):** full scenario plays out; Hermes declares M0 done.
- **Post-mortem (Day 11):** what slipped, what surprised us, what we want to change for M1.

## 8. Risk register (top 5, owner + mitigation)

| # | Risk | Owner | Mitigation |
|---|---|---|---|
| R1 | Schema migration breaks existing data | Codex | Run migration in a copy of the live DB first; verify row counts before/after |
| R2 | AI costs (LLM) blow up in prod | MiniMax | Deterministic path covers ≥ 80% of intents; rate limit per session; per-day budget alert at 80% |
| R3 | WhatsApp template approval takes days | OPS | Submit templates in week 1; have email-only fallback for the demo |
| R4 | Cleaner smartphones are slow / old | MiniMax | `/cleaner` is its own tiny bundle; no Three.js, no GSAP |
| R5 | Owner is the only reviewer and is traveling | Hermes | Async-first; everything in PRs; emergency hotfix path documented |

## 9. Acceptance for the 2-week plan

- All `MUST` tasks (T-CX-01 through T-OPS-06, T-MM-01 through T-MM-08, T-QA-01 through T-QA-04, T-SE-01 through T-SE-04) are merged.
- All `SHOULD` tasks are either done or moved to M1 with a written reason.
- E2E-12 (full scenario) passes in production 5 days in a row.
- The 7 audit findings are closed and signed off.
- The owner can demonstrate the M0 scenario live, on a real phone, in 3 languages.
