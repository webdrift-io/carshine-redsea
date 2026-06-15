# Agent Handoff

Status: M0-000 complete; M0-001 implemented and verified; M0-002b complete; M0-003 implemented and ready for Hermes review.

## Current Controller Notes

- Required `docs/rebuild/*.md` roadmap files are present.
- Control docs were created during this audit: `docs/IMPLEMENTATION_QUEUE.md`, `docs/AGENT_HANDOFF.md`, `docs/M0_STATUS.md`.
- Current repo has legacy real SQLite persistence, not the planned normalized M0 schema.
- Service baseline is blocked by a locked/missing `better-sqlite3` install after `npm ci` failed with EPERM on the native module.
- The lock was resolved by stopping the project-like `node server.js` process. MCP/Open Design/Xcode Node processes were left alone.
- Recommended next PR after Hermes review is M0-004.

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

## Verification Snapshot

- `service-agent npm run test:migrations`: 5 passed.
- `service-agent npm run test`: 137 passed after M0-003.
- `service-agent npm run lint`: 0 errors, warnings remain pre-existing/style-level.
- `service-agent npm run typecheck`: passed.
- Root and landing builds passed.
- Root `npm audit --audit-level=high`: passed, 0 vulnerabilities.
- `landing-page npm audit --audit-level=high`: passed, 0 vulnerabilities.
- `service-agent npm audit --audit-level=high`: passed; 2 low vulnerabilities remain via `@mastra/core`.

## Claimed Specialist Ownership

- Codex: M0-004 handoff support, M0-006, M0-007 backend/API/database.
- MiniMax/UI agent: M0-004, dashboard UI portions of M0-005/M0-006/M0-007.
- QA agent: M0-002 test baseline and M0-008.
- Security agent: review M0-001 append-only audit, M0-006 payment verify authorization, and M0-007 RBAC.
