# CarShine Red Sea — Project Notes for Mavis

This file is auto-loaded when working in this project. Anything in
`~/.mavis/agents/mavis/memory/MEMORY.md` also applies.

## What this project is

Mobile car wash booking platform for El Gouna, Hurghada, Sahl Hasheesh (Egypt).
Multilingual (EN/AR/DE + RTL). Premium positioning, real money on the line.

- **Repo:** `C:\Users\hamad\Documents\car whased in Egypt redsea\`
- **Backend:** Express + SQLite + Socket.io (`service-agent/`)
- **Frontend landing:** Vite + Three.js + GSAP (`landing-page/`)
- **AI:** MiniMax-M3 primary, Gemini fallback, rule-based last resort
  (`service-agent/minimax-agent.js` — current monolith, see upgrade path below)
- **Admin dashboard:** vanilla JS, dark glassmorphism, 7 sections
  (`service-agent/public/`)
- **Marketing:** Postiz orchestrator, currently draft-only

## The upgrade path (do these in order, not all at once)

1. **Multi-agent split** — replace `minimax-agent.js` with Mastra
   3-agent pipeline. Full prompts in `service-agent/agents/AGENT_PROMPTS.md`.
   Drop-in: RouterAgent + IntakeAgent + BookingAgent + HandoffAgent.
2. **Mem0** — wire `lookupCustomerTool` so returning customers get a
   personal greeting and last-booking context.
3. **Langfuse** — wrap `orchestrator.generate()` with a trace; tag with
   `chatSessionId` + `language` + `finalOutcome`.
4. **Playwright E2E** — 5 tests: book, cancel, reschedule, complaint
   handoff, returning customer.
5. **Dashboard UI refresh** — migrate from 1,278-line vanilla `app.js`
   to shadcn/ui + Radix + Tailwind. Keep the dark glassmorphism look.

## Stack defaults for this project

| Layer | Tool | Path |
|---|---|---|
| Agent framework | **Mastra** | `03-agents/mastra` |
| Memory | **Mem0** | `03-agents/mem0` |
| LLM observability | **Langfuse** | `02-ops/langfuse` |
| E2E tests | **Playwright** | `02-ops/playwright` |
| UI components | **shadcn/ui** | `01-saas-base/ui` |
| A11y primitives | **Radix UI** | `01-saas-base/primitives` |

(All under `C:\Users\hamad\Downloads\github open source\` — the agent's
default stack catalog. Don't pull from elsewhere without good reason.)

## Hard rules for this project

- **Arabic replies must be Egyptian colloquial**, never Fusha. Look for
  "يا فندم", "منورنا", "حبيبي", "تمام يا باشا".
- **Never book a slot the SlotValidator hasn't approved.** Tool-first,
  not LLM-trust.
- **Returning customers get greeted by name** — Mem0 lookup is
  mandatory, not optional.
- **No hardcoded secrets.** `JWT_SECRET`, `MiniMax_API_KEY`,
  webhook signing secrets — all from env. CI has a pre-deploy check.
- **3 languages always tested.** EN, AR (RTL), DE. If you build a
  feature in one, ship it in all three.
- **Auto-publishing is forbidden** without explicit human approval.
  Socials stay in draft/queue. WhatsApp/email blast requires an audit
  log entry.

## Testing commands

```bash
cd service-agent
npm test                  # 78 unit tests
npm run test:coverage     # coverage report
npm run lint              # ESLint
npm run typecheck         # tsc --noEmit
```

## Local dev quick start

```bash
# terminal 1 — landing page
cd landing-page && npm install && npm run dev

# terminal 2 — service agent (backend + dashboard)
cd service-agent && npm install && npm start
# → http://localhost:5000 (dashboard) /api-docs (swagger)
# → login: admin@carshineredsea.com / ChangeMe123! (change in prod)
```

## Status (last audit 2026-06-12)

- ✅ 78 unit tests pass, 7 integration tests pass
- ✅ 0 hardcoded secrets
- ✅ 0 vulnerabilities
- ⚠️ Marketing autopilot is draft/queue — not real publishing yet
- ⚠️ Lint has pre-existing errors in parsers/tests (low priority)
- ⚠️ Dashboard still vanilla JS, needs shadcn/ui migration
- ⚠️ Monolith agent needs multi-agent split (Mastra)

## Don'ts

- Don't add a 4th agent framework. Mastra is the choice.
- Don't add 3 alternative UI libraries. shadcn/ui + Radix.
- Don't touch the SQLite schema without a migration script in
  `service-agent/migrations/`.
- Don't push to `main` without the CI workflow green.
