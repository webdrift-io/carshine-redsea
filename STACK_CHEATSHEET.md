# When to use each of the 19 cloned repos

This is the cheat sheet for your open-source stack at `C:\Users\hamad\Downloads\github open source\`.
Don't say "use this repo" — say the **need** (the user problem), and I'll pick the right one.

---

## 1. SaaS base layer (start here for any new app)

| Repo | When to use it | When NOT to use it | Local path | What to say in chat |
|---|---|---|---|---|
| **SaaS-Boilerplate** (ixartz) | New Next.js SaaS, multi-tenant, Drizzle, Stripe, Storybook, i18n already wired. **Start here for any new SaaS.** | Simple one-page app, internal tool, or anything that doesn't need multi-tenant | `01-saas-base/SaaS-Boilerplate` | "Build me a SaaS for X" |
| **saas-starter** (nextjs) | Quick Next.js app with Stripe + Postgres + Drizzle + shadcn/ui + NextAuth. Simpler than SaaS-Boilerplate. | You need i18n, multi-tenancy, or Vitest setup | `01-saas-base/saas-starter` | "Quick Next.js app with Stripe" |
| **shadcn/ui** | Any new React/Tailwind UI. Registry of components. **Default for all UI work.** | You're on a non-React stack (Vue, Svelte) | `01-saas-base/ui` | (I auto-reach; you don't need to name it) |
| **Radix UI** | Accessible primitives (dialogs, dropdowns, tabs). Pairs with shadcn. | Already have a UI lib | `01-saas-base/primitives` | "Need accessible dialog" |
| **Tailgrids** | Pre-built marketing blocks (hero, pricing, footer). | shadcn has the block, or you want custom | `01-saas-base/tailgrids` | "I need a marketing landing page fast" |
| **Fumadocs** | Docs site for a project. | The project doesn't need docs | `01-saas-base/fumadocs` | "Add docs site" |

**2-line rule:** New app = SaaS-Boilerplate or saas-starter. New UI = shadcn. Anything else = ask.

---

## 2. Ops layer (production infrastructure)

| Repo | When to use it | When NOT to use it | Local path | What to say in chat |
|---|---|---|---|---|
| **PostHog** | Product analytics, funnels, feature flags, session replay, A/B tests. **Use this for ALL analytics in your projects.** | You only need server logs | `02-ops/posthog` | "Track conversion funnel" / "Add analytics" |
| **Langfuse** | Tracing LLM calls, prompt versions, evaluating AI outputs. **Use this for ANY project with AI/LLM.** | Project has no AI | `02-ops/langfuse` | "Add observability for the agent" |
| **OpenObserve** | Logs/metrics/traces. Drop-in Datadog/Splunk replacement. **Rust-based, Docker-only.** | Just use hosted Langfuse or PostHog for most things | `02-ops/openobserve` | "Need a Datadog alternative" |
| **Playwright** | E2E browser tests, especially booking flows, chat widgets, form submissions. **Default for E2E in any web project.** | Pure API-only (no UI) | `02-ops/playwright` | "Add E2E tests for the booking flow" |

**2-line rule:** New project with LLM = Langfuse. Web project = Playwright E2E. Analytics = PostHog.

---

## 3. Agents layer (AI agent frameworks)

**⚠️ Important: pick ONE. Don't mix.**

| Repo | When to use it | When NOT to use it | Local path | What to say in chat |
|---|---|---|---|---|
| **Mastra** | **Default for ALL TS agent projects.** Modern, TS-first, memory, RAG, MCP, voice, workflows. | You're locked into a different stack | `03-agents/mastra` | "Build me an AI agent for X" |
| **VoltAgent** | Only if you want voice/RAG-heavy platform with VoltAgent-specific patterns. | Most cases | `03-agents/voltagent` | "Use VoltAgent instead of Mastra" |
| **OpenAI Agents JS** | Only if you must use OpenAI SDK directly. | Most cases | `03-agents/openai-agents-js` | (rarely) |
| **Microsoft Agent Framework** | **.NET or Python** projects. | TS or JS projects | `03-agents/microsoft-agent-framework` | ".NET agent for X" |
| **Google ADK** | **Python** projects that need Google's agent eval tooling. | TS/JS | `03-agents/google-adk-python` | "Python agent for X" |
| **Mem0** | Long-term memory for agents (remembering returning customers, conversation history across sessions). | Single-session, stateless | `03-agents/mem0` | "Agent should remember returning customers" |

**2-line rule:** TS project = Mastra. Python = Google ADK. Need memory across sessions = Mem0 (adds to any framework).

---

## 4. Payments

| Repo | When to use it | When NOT to use it | Local path | What to say in chat |
|---|---|---|---|---|
| **Polar** | Building a SaaS that needs subscriptions / payments. | You're a service business (you are), or you don't take money online | `04-payments/polar` | "Add subscriptions to my SaaS" |

**Don't use Polar for your car wash.** You take InstaPay / Vodafone Cash / Fawry, not card subs.

---

## Quick decision flow

```
Building a new project?
  ├─ SaaS / multi-tenant → SaaS-Boilerplate
  ├─ Simple Next.js app → saas-starter
  └─ Other → ask me

Adding UI?
  └─ shadcn/ui (auto, I just use it)

Adding LLM features?
  ├─ Need agent that does things → Mastra
  ├─ Need to TRACE the LLM → Langfuse
  └─ Need to REMEMBER across sessions → Mem0

Adding observability?
  ├─ User behavior → PostHog
  ├─ LLM behavior → Langfuse
  ├─ Server logs → OpenObserve (Docker, last resort)
  └─ Browser tests → Playwright

Adding docs?
  └─ Fumadocs

Need payments?
  └─ Polar (only if SaaS, not for service business)
```

---

## What to say in chat — examples

✅ **Good (let me pick the right tool):**
- "Build me a SaaS for booking yoga classes" → I pick SaaS-Boilerplate + shadcn + Mastra + Langfuse
- "Add analytics to the landing page" → I pick PostHog
- "Customers complain the chatbot forgets them" → I pick Mem0
- "Make a docs site for the API" → I pick Fumadocs
- "Test the booking flow end-to-end" → I pick Playwright

❌ **Bad (don't name a specific repo):**
- "Use SaaS-Boilerplate" (let me pick)
- "Use Langfuse for the agent" (let me pick)
- "Use Mastra" (let me pick)

**Exception:** if you specifically want a different tool than I'd default to, name it. E.g., "Use VoltAgent instead of Mastra" — that's a real override.

---

## Will the same work with any AI?

Yes — the table is about tools, not models. Any AI (me, Codex, Hermes, Claude, GPT) that has access to the repos can use them. The agent memory I wrote auto-loads this table into my context every session, so I never forget. If you switch to a different AI, you'll need to give it the same stack catalog (or just paste this file into its context).
