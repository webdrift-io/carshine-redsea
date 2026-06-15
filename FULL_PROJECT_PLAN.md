# CarShine Red Sea — Full Multi-Agent Architecture & Marketing Plan

## 1. The system at a glance

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CarShine Red Sea                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   ┌──────────────────────┐         ┌──────────────────────┐         │
│   │   LANDING PAGE        │         │   ADMIN DASHBOARD    │         │
│   │   (Vite, 3 langs)     │         │   (Express, Socket.io)│         │
│   │   ✅ FIXED            │         │   ✅ Working         │         │
│   └────────┬─────────────┘         └────────┬─────────────┘         │
│            │ chat widget                     │ manage               │
│            ▼                                  ▼                     │
│   ┌─────────────────────────────────────────────────────┐          │
│   │              SERVICE AGENT (Express API)              │          │
│   │  ┌───────────────────────────────────────────────┐  │          │
│   │  │      MULTI-AGENT BRAIN (Mastra)                │  │          │
│   │  │  Router → Intake → Booking → Handoff           │  │          │
│   │  │  + Mem0 (memory) + Langfuse (observability)    │  │          │
│   │  └───────────────────────────────────────────────┘  │          │
│   │  + SQLite (bookings, chats, calendar)                │          │
│   │  + OpenAPI 3.0.3 spec + Swagger UI                  │          │
│   └──────────────────┬──────────────────────────────────┘          │
│                      │                                              │
│                      ▼                                              │
│   ┌─────────────────────────────────────────────────────┐          │
│   │       MARKETING AUTOPILOT (orchestrator.js)         │          │
│   │                                                       │          │
│   │  ContentAgent  →  ImageAgent  →  OverlayAgent        │          │
│   │       │               │              │                │          │
│   │       └───────────────┴──────────────┘                │          │
│   │                       │                               │          │
│   │                       ▼                               │          │
│   │             PostAgent (Postiz API)                    │          │
│   │             AnalyticsAgent (Postiz + RevenueCat)      │          │
│   │             StrategistAgent (iterates on what works)  │          │
│   └─────────────────────────────────────────────────────┘          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. The 4 agents in the booking brain (already designed in AGENT_PROMPTS.md)

| Agent | Model | Job |
|---|---|---|
| **RouterAgent** | GPT-4o-mini | Classify intent (book/info/cancel/complaint), extract slots, detect language + sentiment |
| **IntakeAgent** | GPT-4o | Conversational greeting, ask for missing fields one at a time, in customer's language |
| **BookingAgent** | GPT-4o | Validate slot via tool, create booking via tool, return confirmation |
| **HandoffAgent** | GPT-4o-mini | Empathy + escalate to human, look up existing booking |

**Tools (Mastra tools, not LLM trust):**
- `lookupCustomer` (Mem0 + DB)
- `checkSlot` (DB query)
- `suggestAlternatives` (DB query)
- `createBooking` (DB insert)
- `findCustomerBooking` (DB query)
- `escalateToHuman` (create ticket)

## 3. The 5 agents in the marketing autopilot (NEW)

| Agent | Job | Currently |
|---|---|---|
| **ContentAgent** | Writes hooks, captions, hashtags, CTAs based on app description + competitor research | Has prompt template, needs LLM wiring |
| **ImageAgent** | Generates 6 slides per post via OpenAI/Replicate/local | Skeleton — needs API key |
| **OverlayAgent** | Adds text overlays to images (node-canvas) | Skeleton |
| **PostAgent** | Posts to TikTok/IG/FB via Postiz API | Skeleton — needs Postiz key |
| **AnalyticsAgent** | Reads Postiz analytics + (optional) RevenueCat. Feeds back to ContentAgent. | Skeleton — needs analytics calls |

## 4. The content pipeline — what runs and when

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ ContentAgent │────▶│  ImageAgent  │────▶│ OverlayAgent │
│ (writes copy)│     │ (6 slides)   │     │ (text on img)│
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                  │
                                                  ▼
                                          ┌──────────────┐
                                          │   PostAgent  │
                                          │ (via Postiz) │
                                          └──────┬───────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │AnalyticsAgent│
                                          │ (track views)│
                                          └──────┬───────┘
                                                 │
                                                 ▼
                                          ┌──────────────┐
                                          │ContentAgent  │
                                          │  (iterate)   │
                                          └──────────────┘
```

**Schedule** (from your config.json):
- 07:30 — morning posts (pre-work scroll)
- 16:30 — afternoon
- 21:00 — evening

**Posting mode:** SELF_ONLY (TikTok draft) so you can add trending sound manually before publishing. IG/FB post PUBLIC.

## 5. What I CAN do today (no API keys needed)

I'll build a **dry-run pipeline** that:
1. Uses my Matrix MCP image generation as a substitute for OpenAI
2. Generates real ad creatives for CarShine (3 sample sets)
3. Saves them to `tiktok-marketing/posts/sample-2026-06-13/`
4. Logs what the PostAgent WOULD post (no real Postiz call)
5. Gives you a downloadable archive of the creative

## 6. What YOU need to do (5 items, total ~30 min)

1. **Sign up OpenAI** (5 min) — get API key, add to `config.json`
2. **Sign up Postiz** (5 min) — get API key + 1 integration
3. **Connect your TikTok business account** via Postiz (5 min)
4. **Connect your Instagram business account** via Postiz (5 min)
5. **Add a `competitor-research.json`** by browsing 10 competitor car-detailing accounts in Egypt (10 min) — OR I can do this with my web search

## 7. Order of operations (the 7-day plan)

| Day | What I do | What you do |
|---|---|---|
| 1 | Wire Mastra multi-agent into service-agent (Router + Intake + Booking + Handoff). Add tools. Test with real booking flow. | Approve agent outputs in the dashboard |
| 2 | Wire Mem0 for returning-customer greeting. Wire Langfuse for tracing. | Review Langfuse dashboard |
| 3 | Add Playwright E2E tests for booking flow (5 tests) | Run tests, approve |
| 4 | Run ContentAgent + ImageAgent dry-run. Generate 3 sample ad sets for CarShine. | Pick your favorite hooks |
| 5 | Sign up Postiz + connect accounts (or hand me the keys) | — |
| 6 | Wire PostAgent + AnalyticsAgent. First real post. | Approve each post in dashboard before publish |
| 7 | Add PostHog funnel tracking (landing → form → submit → confirmed) | Review conversion data |

## 8. Realistic revenue expectation

CarShine Red Sea is a service business, not an app. The marketing autopilot's job is **lead generation**, not virality. Realistic outcome:

- **Week 1-2:** 5-10 leads/week from social (3 posts/day)
- **Month 1:** 20-30 leads/week, 30% booking rate = 6-9 bookings/week
- **With Trial Wash at 150 EGP + Smart Plan at 300 EGP/month:** roughly 3,000-6,000 EGP/month additional revenue from social-driven bookings

The agent doesn't replace word-of-mouth in El Gouna/Hurghada. It supplements it. The biggest ROI is **Mastra-powered chatbot converting WhatsApp inquiries** — that should be Day 1 priority, not the social autopilot.

## 9. What I'll do RIGHT NOW (no keys needed)

1. Build a dry-run version of the marketing agents
2. Generate 3 real sample ad creatives for CarShine (3 different hooks)
3. Add them to a folder you can review
4. Set up the Mastra multi-agent skeleton in service-agent (code only, not run)
5. Show you the full architecture diagram

Want me to start with #1-5? Or do you want to give me the API keys first so I can wire the real thing?
