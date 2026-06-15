# Agent Handoff

Status: M0-000 complete; M0-001 implemented and verified; M0-002b complete; M0-003 implemented and verified by Hermes; M0-003b implemented.

## Current Controller Notes

- Required `docs/rebuild/*.md` roadmap files are present.
- Control docs were created during this audit: `docs/IMPLEMENTATION_QUEUE.md`, `docs/AGENT_HANDOFF.md`, `docs/M0_STATUS.md`.
- Current repo has legacy real SQLite persistence, not the planned normalized M0 schema.
- Service baseline is blocked by a locked/missing `better-sqlite3` install after `npm ci` failed with EPERM on the native module.
- The lock was resolved by stopping the project-like `node server.js` process. MCP/Open Design/Xcode Node processes were left alone.
- Recommended next PRs: Codex M0-003b (slot_check + COLLECTING_INFO payment skip) and MiniMax M0-004 (landing form real wiring). They are independent and ship in parallel.

## Completed Work

- Phase A commit: `89ae633 chore: establish m0 safe baseline`.
- Root build script fixed.
- Backup created in ignored `backups/`.
- `service-agent/start-server.bat` no longer hardcodes a webhook secret-like value.
- M0 migration runner and schema foundation added.
- Migration tests prove empty DB, rerun idempotency, legacy preservation, dev seed, and payment safety triggers.
- WhatsApp environment naming canonicalized to `WHATSAPP_*`.
- Deprecated WhatsApp `META_*` aliases are supported for one release with warnings and no secret values printed.
- CI high-severity npm audit gate now runs and fails on root, `landing-page`, and `service-agent`.
- Root and landing high audit findings were cleared by upgrading Vite / `@vitejs/plugin-legacy`.
- M0 public booking service added at `service-agent/services/public-bookings.js`.
- `/api/public/bookings` now writes normalized M0 rows in one transaction and returns a legacy-compatible `booking` object.
- Public booking writes `customers`, optional `vehicles`, `bookings_v2`, `booking_status_history`, `payments`, `payment_events`, and optional channel memory rows.
- M0-003 intentionally does not dual-write to legacy `bookings`; legacy tables remain preserved for fallback/read-only compatibility.
- Initial payment state is only `PAYMENT_INSTRUCTIONS_SENT` or `UNPAID`; public booking input cannot set `VERIFIED`.
- Incomplete public intake creates `COLLECTING_INFO` rows with explicit `missingFields`. Schema-required missing service/time values use documented intake placeholders.
- M0-003b: `payments` and `payment_events` rows are only created for `QUOTED` bookings. `COLLECTING_INFO` and `NEEDS_HUMAN` bookings store no payment rows; API returns `paymentStatus: null`.
- M0-003b: slot/past-time precondition: past `scheduledStart` or conflicting active slot blocks `QUOTED` creation and returns a non-success response without writing any booking rows.

## Verification Snapshot

- `service-agent npm run test:migrations`: 5 passed.
- `service-agent npm run test`: 140 passed after M0-003b (was 137 after M0-003).
- `service-agent npm run lint`: 0 errors, warnings remain pre-existing/style-level.
- `service-agent npm run typecheck`: passed.
- Root and landing builds passed.
- Root `npm audit --audit-level=high`: passed, 0 vulnerabilities.
- `landing-page npm audit --audit-level=high`: passed, 0 vulnerabilities.
- `service-agent npm audit --audit-level=high`: pre-existing ws/socket.io high findings via `@mastra/core` and `socket.io`; not introduced by M0-003b. Fix requires breaking-change upgrades.

## Claimed Specialist Ownership

- Codex: M0-004 handoff support, M0-006, M0-007 backend/API/database.
- MiniMax/UI agent: M0-004, dashboard UI portions of M0-005/M0-006/M0-007.
- QA agent: M0-002 test baseline and M0-008.
- Security agent: review M0-001 append-only audit, M0-006 payment verify authorization, and M0-007 RBAC.

## M0-003 Verified by Hermes (2026-06-15)

- **Pass.** 137 tests green. M0 schema writes are transactional and safe.
- Live exercise confirmed: happy path, missing fields, idempotency, payment-poison resistance.
- The audit's standing decision "AI must never mark payment VERIFIED" remains enforced at the DB layer and is now also enforced at the API layer.
- Codex M0-003 prompt accepted as-is with four small follow-ups (§11 of the review) that do not block M0-004.
- Full review: `docs/M0_REVIEW_000_003.md`.
