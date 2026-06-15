# CarShine Red Sea Implementation Plan

## Current Diagnosis

- Landing page is a multilingual Vite site with premium content and real booking CTAs, but the default landing build was broken because production mode looked for `index.production.html`.
- Service agent has real Express, SQLite, Socket.io, chatbot, booking, calendar, dashboard, and 78 passing tests.
- Dashboard data contracts were partly mismatched with the API, causing social posts and chat sessions to crash on partial data.
- Social media automation is currently draft/queue architecture. Real analytics and publishing require Postiz/image provider credentials and explicit approval policy.
- WhatsApp/email automation is architected, but production safety depends on configured signing secrets and provider credentials.

## What Is Good

- Backend test suite passes and covers parser/database behavior.
- SQLite schema and API routes support bookings, chat sessions, calendar, agents, social posts, and health checks.
- Marketing validator fails closed when real credentials are missing.
- Dashboard has a useful operator information architecture: overview, chat, approvals, calendar, social media, settings, and agents.
- Landing content already targets Red Sea areas and three languages.

## Missing Or Risky

- Real social analytics and publisher integration are not connected yet.
- Some dashboard copy still describes autopilot/social functions more strongly than the current backend can prove.
- Production needs real `JWT_SECRET`, webhook signing secrets, email credentials, WhatsApp provider credentials, and Postiz/image provider credentials.
- Lint still has pre-existing errors in parser/test files.
- Landing page and dashboard need deeper mobile UX polish and full visual QA.

## Architecture Direction

- Keep landing as static multilingual Vite output with a fast booking/chat handoff.
- Keep service-agent as the operations API and dashboard backend.
- Treat marketing autopilot as draft-and-queue until approval and credentials are configured.
- Keep dangerous actions gated: publishing, outbound WhatsApp/email campaigns, and automation toggles need audit logs and explicit controls.
- Add provider abstraction for AI and media providers so MiniMax, Gemini, NVIDIA/MiMo, OpenAI, or future providers can be swapped.

## Implemented Foundation Changes

- Fixed landing `npm run build` default language resolution.
- Made production webhook verification fail closed when Meta/Twilio signing secrets are missing.
- Disabled synthetic agent activity in production.
- Required admin role for agent toggles and added audit logging.
- Added localhost-only development auth bypass so the local dashboard can be tested while production remains protected.
- Replaced fake social view counts with `--` and made analytics API report unconnected status.
- Hardened dashboard rendering for social posts and chats with missing/legacy fields.
- Converted dashboard accent tokens toward black/white grayscale instead of green theme.

## Next Steps

1. Clean existing lint errors in `service-agent/parsers.js` and tests.
2. Add a real login route/screen instead of relying on localhost dev bypass.
3. Add inline booking form validation and accessible errors on the landing page.
4. Add explicit dashboard labels for unconnected social analytics and draft-only publishing.
5. Build provider abstraction for chatbot/media providers and document env requirements.
6. Add approval workflow and audit trail for outbound email, WhatsApp, and social publishing.
7. Run full desktop/mobile Browser QA for landing, dashboard, chatbot widget, booking, and calendar flows.
