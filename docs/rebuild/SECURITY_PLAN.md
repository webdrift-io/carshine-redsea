# Security Plan

> Status: **DRAFT v1.0** • Owner: Security agent (with Coding Engineer for implementation)
> The audit named 7 risks. This plan closes each one, plus the ones the audit didn't name but should have.

---

## 1. Threat model (one paragraph)

The system stores: customer PII (name, phone, email, address, location history), payment records (InstaPay references, screenshots), and operational data (assignments, calendar, internal notes). The attackers we care about: a curious developer running the app locally with secrets checked in; a former cleaner with a stale JWT; a customer trying to view someone else's booking by guessing `public_ref`; an attacker spamming our chatbot to consume LLM budget or extract system prompts; a compromised `npm` dependency. The non-attackers we still defend against: a tired owner clicking the wrong button.

## 2. The 7 audit findings — closed

### F-SEC-1: Real `.env` exists locally
**Risk:** secrets in the working tree; could be committed.
**Fix:**
- Add `service-agent/.env` to `.gitignore` (verify it's already there).
- Add a pre-commit hook (Husky or `pre-commit` framework) that runs `git diff --cached -- service-agent/.env` and refuses the commit.
- Add a CI step: `git ls-files | grep -E '\.env$|\.env\.' && exit 1` — fail the build.
- `service-agent/.env.example` is the only env-shaped file tracked. Add a `// NEVER COMMIT A REAL .env` banner at the top.
- **Acceptance:** `git ls-files | grep -E '\.env$'` returns nothing in CI.

### F-SEC-2: JWT secret falls back to random per boot
**Risk:** sessions silently invalidated; config errors hidden.
**Fix:**
- `auth.js` `requireEnv('JWT_SECRET', { minLength: 32 })`. If missing or too short, refuse to start. The dev seed provides a known dev secret in `.env.example` so dev works out of the box.
- Production `JWT_SECRET` is rotated every 90 days via a documented runbook (`docs/runbooks/jwt-rotation.md`).
- **Acceptance:** booting without `JWT_SECRET` exits non-zero with a clear error.

### F-SEC-3: Localhost auth bypass masks production failures
**Risk:** the dev bypass is on when it shouldn't be.
**Fix:**
- Bypass is **off by default**.
- Bypass is **on** only when `NODE_ENV=development` AND `ENABLE_DEV_BYPASS=true`. Both required. Documented in `.env.example`.
- Every request that uses the bypass logs `[WARN] dev bypass active` with the route and IP.
- Production startup asserts `ENABLE_DEV_BYPASS !== 'true'`. If it is, refuse to start.
- **Acceptance:** booting in `NODE_ENV=production` with `ENABLE_DEV_BYPASS=true` exits non-zero.

### F-SEC-4: WhatsApp signature verification skipped when secret missing
**Risk:** an attacker can POST to `/api/public/inbound/whatsapp` and impersonate customers.
**Fix:**
- `WHATSAPP_APP_SECRET` is **required** when `NODE_ENV=production`.
- The webhook route verifies the `X-Hub-Signature-256` header against the raw body using HMAC-SHA256.
- In `NODE_ENV=development`, a missing secret logs a clear warning but allows it (so devs can curl).
- Every inbound request that fails signature verification is logged with full headers (redacting the body) and returned 401.
- **Acceptance:** a request with a wrong signature returns 401, a request with a missing signature in prod returns 401, a request with the correct signature in dev is processed.

### F-SEC-5: Env name mismatch leaves WhatsApp "configured" but disconnected
**Risk:** the operator thinks WhatsApp is wired because `.env.example` is filled in, but the code reads different names.
**Fix:** see `CLEANUP_PLAN.md` §6. Canonical names are `WHATSAPP_*`. `META_*` is a one-release alias with a startup `console.warn`. CI fails the build if any code reads `META_*`.
- **Acceptance:** `git grep -nE 'META_(ACCESS|PHONE)_' -- service-agent/` returns only the alias shim with the warning.

### F-SEC-6: npm vulnerabilities
**Risk:** known CVEs in transitive deps.
**Fix:**
- `npm audit` runs in CI on every PR. **High** and **critical** fail the build. **Moderate** is allowed with a justification in the PR body.
- Renovate or Dependabot configures auto-PRs for security patches.
- The audit's 7 vulnerabilities are remediated in the cleanup commit `c00` (dedicated, separate from feature work).
- **Acceptance:** `npm audit --audit-level=high` returns 0 across root, `service-agent/`, `landing-page/`.

### F-SEC-7: No normalized audit log for admin/payment actions
**Risk:** no forensic record of who did what.
**Fix:** see `DATABASE_SCHEMA_PLAN.md` §4.10 (`payment_events`) and §4.6 (`booking_status_history`). Both are append-only, trigger-enforced. A new `agent_actions` table (§4.14) logs every AI tool call.
- `bookings.status` changes by humans go through `booking_update_status` → `booking_status_history` row.
- `payments.status` changes go through `payment_verify` → `payment_events` row.
- Dashboard exposes an "Audit" page (read-only, owner-only) that joins these.
- **Acceptance:** every state-changing admin action in E2E tests produces an audit row.

## 3. Additional controls (the audit didn't name, but we add)

### S-1: Rate limiting
- `express-rate-limit` on every `/api/public/*` route.
- Per IP: 60 req/min, 600 req/h.
- Per `customer_id`: 30 messages/h (chat-specific, prevents spam burn).
- Per `phone_e164`: 5 booking attempts/h (prevents duplicate-book spam).
- Per `chat_session_id`: 10 tool calls/min.
- 429 responses include `Retry-After` and a friendly Arabic/English/German message ("عذراً، كتير طلبات. حاول كمان شوية.").

### S-2: Input validation
- Every public route validates body with Ajv against JSON schemas in `service-agent/schemas/`.
- Reject unknown fields (no `__proto__`, no `constructor`).
- Phone numbers normalized to E.164 (or rejected with a clear error).
- Email addresses lowercased + RFC 5321 validation.
- Free-text fields (`notes`, `address`) length-capped (500 chars).

### S-3: SQL safety
- All DB access goes through `database.js` prepared statements.
- Linter rule: no template-string SQL.
- ESLint custom rule (or grep gate in CI) blocks `.exec(` and `.run(` with non-static args.
- **Acceptance:** `git grep -nE '\.run\(` -- service-agent/ | grep -v prepare` returns nothing.

### S-4: Output encoding
- All template rendering escapes HTML by default.
- `escape-html` applied to customer-supplied strings before they reach any HTML context.
- The dashboard's CSP forbids inline scripts: `Content-Security-Policy: default-src 'self'; script-src 'self'; ...`. The chat widget is loaded from `'self'` only.

### S-5: Authentication hardening
- bcrypt cost factor 12 (raised from 10 in the audit) for new hashes; existing hashes migrated on next login.
- JWT TTL: 8h for owner/dispatcher, 30 days for cleaner (long field shifts), 24h for public status page tokens.
- Refresh tokens are signed separately; rotating them is part of the 90-day JWT rotation.
- Logout: client clears the token; server maintains a `token_revocations` table (small, LRU) so a stolen token can be invalidated.

### S-6: Authorization (RBAC)
- Every `/api/admin/*` route uses `requireRole(['OWNER', 'DISPATCHER'])`.
- Every `/api/cleaner/*` route uses `requireRole(['CLEANER'])` AND `requireOwnership(booking)`.
- The public status page uses a per-booking random token (`booking_view_tokens`); no PII is leaked if the token is missing.
- **Acceptance:** every E2E test asserts role-based denials (cleaner cannot see another cleaner's job, customer cannot see another customer's booking, etc.).

### S-7: PII handling
- PII columns are not in the `agent_actions.tool_call.input` JSON; the tool layer redacts `phone`, `email`, `address` before logging.
- Mem0 receives `customer_id` (not `phone`/`email`).
- Langfuse traces redact `screenshot_url` (we keep the template_code but not the URL).
- Logs: `logger.js` has a redact list; PII never lands in `service-agent.log`.

### S-8: File upload safety
- Receipt screenshots: see `PAYMENT_FLOW.md` §5. Magic-number sniff the first 16 bytes; reject anything that isn't JPEG/PNG/WebP/HEIC, regardless of the `Content-Type` header.
- Filename is always a server-generated UUID; the client filename is ignored.

### S-9: Webhook idempotency
- Every inbound webhook (WhatsApp, email) carries an idempotency key. Duplicate deliveries are dropped silently.
- DB constraint: `chat_messages UNIQUE(provider, provider_message_id)`.

### S-10: Dependency hygiene
- `package-lock.json` is committed at the repo root and in each sub-package.
- CI runs `npm ci`, not `npm install`, to guarantee lockfile parity.
- Renovate config opens weekly PRs for non-security updates; security updates are immediate.
- No `npm install <pkg>` without an associated PR. **PR title must include the package name and reason.**

## 4. Incident response (one page)

```
1. Detect       — owner sees a 5xx spike in /health, or a customer reports weird messages
2. Contain       — set MAINTENANCE_MODE=true in env, restart, dashboard shows "we're back soon"
3. Investigate   — service-agent.log + agent_actions + payment_events + booking_status_history
4. Communicate   — owner messages affected customers via WhatsApp blast (gated: explicit approve)
5. Remediate     — patch, redeploy, write postmortem within 7 days
6. Verify        — re-run full E2E suite + a manual "did it really happen" call to 2 affected customers
```

A runbook lives at `docs/runbooks/incident.md`.

## 5. Compliance posture (lightweight, M0)

- **GDPR (international visitors):** customers can request their data (`GET /api/public/me?token=...` returns a JSON dump, or owner runs an export). Customers can request deletion (soft delete + 30-day hard delete job).
- **Egypt PDPL (Law 151/2020):** same data-export and deletion endpoints satisfy Article 17-ish. We do not sell or share data.
- **PCI:** we never touch card data. InstaPay is a peer-to-peer bank transfer; we hold no card numbers, CVVs, or expiry dates. **We are explicitly out of PCI scope** for M0.
- **Logging retention:** `service-agent.log` rotates daily, kept for 30 days; `agent_actions` kept for 90 days; `payment_events` and `booking_status_history` kept for 5 years (accounting).

## 6. Pre-deploy security checklist (the CI gate)

Every PR that touches `service-agent/`, `landing-page/`, or root `package.json` must satisfy:

- [ ] No new high/critical `npm audit` issues
- [ ] No `META_*` env name reads
- [ ] No `.run(` or `.exec(` with non-static args
- [ ] No `console.log` of PII
- [ ] No new dependencies without a `// why: ...` comment + Renovate entry
- [ ] New routes have a role check + input validation
- [ ] `npm run security:check` (custom script, see below) passes

```js
// scripts/security-check.js
const checks = [
  ['No real .env', () => execSync('git ls-files | grep -E "\\.env$"', {stdio:'pipe'}).toString().trim() === ''],
  ['No META_* reads', () => execSync(`git grep -nE 'META_(ACCESS|PHONE)_' -- service-agent/ || true`).toString().trim() === ''],
  ['JWT_SECRET required', () => process.env.JWT_SECRET?.length >= 32 || process.env.NODE_ENV === 'test'],
  // ... etc
];
```

## 7. Acceptance for the security plan

- All 7 audit findings are closed and verifiable by a test or CI gate.
- `npm run security:check` is part of the CI pipeline and passes.
- `npm audit --audit-level=high` is clean.
- A simulated attacker fuzzing `/api/public/inbound/whatsapp` without a valid signature is rejected.
- A simulated attacker guessing `public_ref` is rejected (token required).
- A stolen cleaner JWT is revocable within 60 seconds by the owner.
- A `payment_events` UPDATE/DELETE attempt throws (DB trigger test).
- A `payment_verify` call by the AI is rejected (orchestrator audit test).

## 8. Open questions

| # | Question | Owner | Due |
|---|---|---|---|
| Q1 | Do we need a bug-bounty / responsible-disclosure email in M0, or M1? | Product | Day 5 |
| Q2 | Should the public status page token be emailed or shown in the WhatsApp message? | Product | Day 4 |
| Q3 | Multi-language log redaction: does the redactor need to know language, or pattern-match only? | Coding Engineer | Day 7 |
| Q4 | Threat model: do we need to defend against a malicious cleaner deleting their own job history? | Product + Security | Day 5 |
