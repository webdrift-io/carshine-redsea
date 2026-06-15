# Cleanup Plan

> Status: **DRAFT v1.0** • Owner: Coding Engineer (with Security sign-off)
> Turn the audit's KEEP / FIX / DELETE / REBUILD lists into a concrete, ordered, safe operation.

---

## 0. Cleanup principles

1. **No big-bang deletes.** Every removal is in its own commit with a `cleanup:` prefix and a clear rollback (git revert one commit).
2. **The audit logs the "before".** Before deleting a file, run `git log -- <path>` to make sure it's not load-bearing somewhere we missed.
3. **Migrations are forward-only and additive in M0.** We do **not** drop the `bookings` or `chat_sessions` tables; we add new tables and migrate data into them.
4. **Archive, don't `rm -rf`.** Anything going away gets moved to `archive/2026-06-pre-rebuild/` with a `WHY-ARCHIVED.md` file.
5. **CI must be green after every commit in this plan.** No "I'll fix CI later."

## 1. Inventory from the audit (verified against current tree)

Files I confirmed exist that the audit flagged for action:

| File | Audit verdict | Plan |
|---|---|---|
| `service-agent/bookings.json` | DELETE_OR_ARCHIVE | Archive (see §3) |
| `service-agent/calendar.json` | DELETE_OR_ARCHIVE | Archive (see §3) |
| `service-agent/public/chatbot-demo.html` | DELETE_OR_ARCHIVE | Delete (no data) |
| `service-agent/chatbot.js` | DELETE_OR_ARCHIVE | Verify unused, then archive |
| `service-agent/gemini-chatbot.js` | DELETE_OR_ARCHIVE | Verify unused, then archive |
| `service-agent/minimax-agent.js` | REBUILD (migrate to Mastra) | Keep as fallback behind `USE_MASTRA_AGENT=false`; remove in M1 |
| `landing-page/src/features/booking-form.js` | FIX | See §4 |
| `index.html` (root) | duplicate landing — pick one | See §5 |
| `landing-page/` (Vite source) | REBUILD as single source | See §5 |
| `service-agent/agents/orchestrator.js` | KEEP | See §6 |
| `service-agent/agents/tools.js` | KEEP | Extend with new tools (see `AGENT_TOOLS_PLAN.md`) |
| `service-agent/memory/mem0.js` | KEEP | Wire into orchestrator greeting path |
| `service-agent/observability/langfuse.js` | KEEP | Keep dry-run; gate on env |
| `service-agent/public/chatbot-widget.js` | KEEP | Refactor: build-time API base URL |
| `service-agent/tests/**` | KEEP | Extend (see `TEST_PLAN.md`) |
| `service-agent/database.js` | KEEP | Refactor: move schemas to migrations/ |
| `service-agent/server.js` | KEEP after cleanup | See §7 |
| `tiktok-marketing/` | PAUSE | Archive (Phase 2) |
| `service-agent/.env` | SECURITY | See `SECURITY_PLAN.md` §3 |

## 2. Decision: which landing page is canonical?

**Decision: `landing-page/` (Vite source) is the canonical landing.** Reasons:

- It's the source of truth with `package.json`, `vite.config.*`, `src/`, and build pipeline.
- The root `index.html` is a 1,200-line hand-edited file with inline booking/chat wiring — the same wiring that the audit found is broken.
- The root `index.html` was a quick "ship something" and was never the right answer.

**Action:** The root `index.html` is **deprecated, not deleted** in M0. We:
1. Add a banner at the top of root `index.html`: *"This page is deprecated. See `landing-page/`."* — keeps any old SEO / link from breaking.
2. Remove from any production build scripts.
3. Archive in M1 once `landing-page/` has a public URL behind the real domain.

## 3. Archive: demo JSON + legacy chatbot files

**Action:** Create `archive/2026-06-pre-rebuild/` at the repo root with the structure:

```
archive/2026-06-pre-rebuild/
├── WHY-ARCHIVED.md
├── service-agent/
│   ├── bookings.json
│   └── calendar.json
└── service-agent-legacy-agents/
    ├── README.md
    ├── chatbot.js
    ├── gemini-chatbot.js
    └── minimax-agent.js
```

**`WHY-ARCHIVED.md` content (minimum):**
```
# Why these files were archived — 2026-06-15

The 2026-06-12 audit found these files were either:
- Demo / test data (bookings.json, calendar.json)
- Superseded by the Mastra multi-agent pipeline in
  service-agent/agents/orchestrator.js
- No longer wired into any code path

They are kept for 90 days for forensic reference.
After 2026-09-15, the archive directory may be removed.
See docs/rebuild/CLEANUP_PLAN.md for the full rationale.
```

**Git:** Move the files with `git mv` to preserve history.

## 4. Fix: `landing-page/src/features/booking-form.js`

**Issues found by the audit:**
1. Posts to `/api/bookings` (admin-protected outside dev) instead of `/api/public/bookings`.
2. Sends wrong field names (`name/car/date/time/payment`).
3. Fake-success fallback on any error.

**Fix (concrete):**
- Update `submit()` to POST `/api/public/bookings` with the canonical payload:
  ```json
  {
    "customerName": "...",
    "phone": "...",
    "email": "...",
    "serviceId": "...",
    "carType": "SEDAN|SUV|PICKUP|VAN",
    "address": "...",
    "scheduledStart": "2026-06-16T10:00:00+02:00",
    "notes": "...",
    "language": "en|ar|de",
    "source": "web_form"
  }
  ```
- Remove the `try/catch → return success` block. Replace with explicit error UI that:
  - Shows a non-modal inline error.
  - Offers a "Continue on WhatsApp" button that opens `https://wa.me/<NUMBER>?text=<ENCODED>`.
  - Offers an "Email us" mailto link.
- Use a build-time env (`import.meta.env.VITE_API_BASE_URL`) for the base URL; default to `/api` (same origin).
- Add `data-testid` hooks on every input for E2E tests.
- Add i18n strings: `ar.json`, `de.json`, `en.json` — no hardcoded English.
- **Acceptance test:** submitting the form with the backend down shows the error UI, not a fake success. CI test enforces this.

## 5. Fix: root `package.json` build script

**Issue:** Root `build` script calls `node ../build-landing.cjs` — `..` resolves **outside** the repo.

**Fix:** Replace with a clear chain:
```json
{
  "scripts": {
    "build": "npm --prefix landing-page run build && npm --prefix service-agent run build",
    "dev": "concurrently \"npm --prefix landing-page run dev\" \"npm --prefix service-agent run dev\"",
    "test": "npm --prefix service-agent test",
    "lint": "npm --prefix service-agent run lint && npm --prefix landing-page run lint",
    "typecheck": "npm --prefix service-agent run typecheck"
  }
}
```
If any sub-package is missing a `lint`/`test` script, add a `// TODO` exit-1 placeholder so the chain doesn't silently skip.

## 6. Fix: WhatsApp env naming

**Issue:** `.env.example` uses `META_ACCESS_TOKEN` / `META_PHONE_NUMBER_ID`; `server.js` reads `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`.

**Fix (one canonical name set):**
- Canonical (keep both `WHATSAPP_*` and accept `META_*` as aliases for one release):
  - `WHATSAPP_PROVIDER=meta`
  - `WHATSAPP_TOKEN=...` (primary)
  - `WHATSAPP_PHONE_NUMBER_ID=...` (primary)
  - `WHATSAPP_BUSINESS_ACCOUNT_ID=...`
  - `WHATSAPP_VERIFY_TOKEN=...` (for webhook verification)
  - `WHATSAPP_APP_SECRET=...` (for signature verification)
- `META_*` names are read as **fallback** for one release with a `console.warn`, then dropped in M1.
- Update `.env.example` to match the canonical names. Add a startup self-check in `server.js`:
  ```
  [startup] WhatsApp config: provider=meta token=✓ phoneId=✓ verify=✓
  ```
  If any required var is missing, log a clear warning and mark integration as `NOT_CONFIGURED` in the integration status endpoint.

## 7. Fix: server.js cleanup

`server.js` is 1,356 lines. Phase 1 cleanup, no rewrite:

1. Extract route handlers into `routes/*.js` (booking, chat, payments, admin, calendar, customers, staff, messages, public).
2. Move integration status / health endpoints into `routes/integrations.js`.
3. Keep `server.js` to: bootstrap, mount routes, Socket.io setup, startup self-checks, graceful shutdown.
4. Target: `server.js` < 250 lines.

## 8. Fix: hardcoded dashboard "operational text"

The audit found dashboard cards mix real DB aggregation with hardcoded display state (e.g., hardcoded "agent list").

**Fix:**
- Every dashboard card reads from the DB or a derived query.
- The "agents" section is removed from the dashboard in M0 (it's a Phase 2 marketing thing). Replace with a real "Staff online" indicator.
- No literal strings for counts, statuses, or names anywhere in `app.js` — all from API.

## 9. Fix: calendar validation / manual insert

**Issue:** Manual `POST /api/calendar` insert has weaker validation than booking-driven event creation.

**Fix:** `POST /api/calendar` is **admin-only** and goes through the same `SlotValidator` as the booking path. Manual insert requires `{ bookingId }` and a reason; it cannot create free-floating events.

## 10. Fix: auth dev bypass clarity

**Issue:** Localhost auth bypass can mask production auth failures.

**Fix:**
- Gated behind `NODE_ENV=development` AND `ENABLE_DEV_BYPASS=true`. Both must be true. If either is missing, the bypass is off — even on localhost.
- Bypass logs a `[WARN] dev bypass active` on every request.
- Production startup asserts `ENABLE_DEV_BYPASS !== 'true'`. If it is, refuse to start.

## 11. Pause: marketing / TikTok / Postiz

**Action:** Move `tiktok-marketing/`, Postiz wiring, and any social scheduler into `archive/2026-06-pre-rebuild/marketing/`. The social_posts and social_analytics tables are not touched in M0. A single `GET /api/integrations/social` endpoint returns `status: "PAUSED_PHASE_2"`.

## 12. The cleanup commit order (so reviewers can follow)

```
c01 cleanup: add archive directory with README
c02 cleanup: move demo JSON files to archive (git mv)
c03 cleanup: move legacy single-agent files to archive
c04 cleanup: move marketing/Postiz/tiktok to archive
c05 cleanup: deprecate root index.html (banner only, no delete)
c06 cleanup: extract routes/*.js from server.js
c07 cleanup: move DB schemas to service-agent/migrations/ (additive)
c08 cleanup: WhatsApp env canonical names + startup self-check
c09 cleanup: dev-bypass explicit env gate
c10 cleanup: chatbot-widget build-time API base URL
c11 cleanup: landing booking form posts to /api/public/bookings, no fake success
c12 cleanup: root package.json build chain
c13 cleanup: dashboard hardcoded agent list removed
c14 cleanup: calendar manual insert goes through SlotValidator
```

Each commit must leave CI green. If a commit breaks tests, it gets reverted, not "fixed in the next one."

## 13. Acceptance for the cleanup plan

- `git grep "fake success" -- landing-page/` returns nothing.
- `git grep "META_ACCESS_TOKEN" -- service-agent/ .env.example` returns nothing (the alias fallback may live in one file with a `console.warn`).
- `git grep "chatbot-demo" -- service-agent/public/` returns nothing.
- `git ls-files | grep "service-agent/bookings.json"` returns nothing.
- `find service-agent -name "*.js" -not -path "*/node_modules/*" -not -path "*/coverage/*" -not -path "*/tests/*" | xargs wc -l` reports `server.js` < 300.
- `npm test` from root runs `service-agent` tests and passes.
- `npm run build` from root succeeds.
- A fresh DB runs all migrations and `service-agent` boots clean against it.

## 14. What we explicitly do NOT touch in cleanup

- We do **not** rewrite the orchestrator. The Mastra pipeline is the right shape; we extend it.
- We do **not** delete the `bookings` or `chat_sessions` tables. We add new tables next to them.
- We do **not** change the Express → Socket.io → SQLite stack.
- We do **not** touch `landing-page/` Three.js / GSAP visuals. They work; cleanup is wiring, not design.
- We do **not** rename the project (CarShine Red Sea) or change the repo path.
