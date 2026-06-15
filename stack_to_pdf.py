from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer,
    HRFlowable, KeepTogether
)
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.platypus import PageBreak

# ── colours ──────────────────────────────────────────────────────────────────
BLUE_DARK  = HexColor('#1E40AF')
BLUE_MID   = HexColor('#2563EB')
BLUE_LIGHT = HexColor('#DBEAFE')
BLUE_RULE  = HexColor('#2563EB')
GRAY_ALT   = HexColor('#F3F4F6')
TEXT_DARK  = HexColor('#111111')
TEXT_MID   = HexColor('#374151')
TEXT_LIGHT = HexColor('#6B7280')
RED_ACC    = HexColor('#DC2626')
GREEN_ACC  = HexColor('#16A34A')
WHITE      = white

PAGE_W, PAGE_H = A4

# ── styles ────────────────────────────────────────────────────────────────────
styles = getSampleStyleSheet()

title_style = ParagraphStyle('Title',
    fontName='Helvetica-Bold', fontSize=24, textColor=BLUE_DARK,
    alignment=TA_CENTER, spaceAfter=4)

subtitle_style = ParagraphStyle('Subtitle',
    fontName='Helvetica-Oblique', fontSize=10, textColor=TEXT_LIGHT,
    alignment=TA_CENTER, spaceAfter=10)

intro_style = ParagraphStyle('Intro',
    fontName='Helvetica', fontSize=9, textColor=TEXT_DARK,
    spaceAfter=6, leading=14)

h1_style = ParagraphStyle('H1',
    fontName='Helvetica-Bold', fontSize=13, textColor=BLUE_DARK,
    spaceBefore=14, spaceAfter=4, borderPad=0)

h2_style = ParagraphStyle('H2',
    fontName='Helvetica-Bold', fontSize=10, textColor=BLUE_MID,
    spaceBefore=6, spaceAfter=2)

body_style = ParagraphStyle('Body',
    fontName='Helvetica', fontSize=9, textColor=TEXT_DARK,
    spaceBefore=1, spaceAfter=1, leading=13)

bullet_style = ParagraphStyle('Bullet',
    fontName='Helvetica', fontSize=9, textColor=TEXT_DARK,
    spaceBefore=1, spaceAfter=1, leftIndent=12, leading=13,
    bulletIndent=0)

rule_style = ParagraphStyle('Rule',
    fontName='Helvetica-Bold', fontSize=9, textColor=BLUE_MID,
    spaceBefore=2, spaceAfter=6)

warn_style = ParagraphStyle('Warn',
    fontName='Helvetica-Bold', fontSize=9, textColor=RED_ACC,
    spaceBefore=2, spaceAfter=4)

footer_style = ParagraphStyle('Footer',
    fontName='Helvetica', fontSize=7, textColor=HexColor('#9CA3AF'),
    alignment=TA_CENTER)

cell_style = ParagraphStyle('Cell',
    fontName='Helvetica', fontSize=8, textColor=TEXT_DARK,
    leading=11, spaceAfter=0, spaceBefore=0)

cell_bold = ParagraphStyle('CellBold',
    fontName='Helvetica-Bold', fontSize=8, textColor=BLUE_MID,
    leading=11)

cell_header = ParagraphStyle('CellHeader',
    fontName='Helvetica-Bold', fontSize=8, textColor=WHITE,
    alignment=TA_CENTER, leading=11)

# ── table builder ─────────────────────────────────────────────────────────────
def build_table(headers, rows, col_widths):
    data = [[Paragraph(h, cell_header) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), cell_style) for c in row])

    ts = TableStyle([
        ('BACKGROUND',   (0, 0), (-1, 0),  BLUE_DARK),
        ('ROWBACKGROUNDS',(0, 1), (-1, -1), [GRAY_ALT, WHITE]),
        ('GRID',         (0, 0), (-1, -1), 0.4, HexColor('#D1D5DB')),
        ('VALIGN',       (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING',   (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 4),
        ('LEFTPADDING',  (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ])
    t = Table(data, colWidths=col_widths, repeatRows=1)
    t.setStyle(ts)
    return t

# ── document ──────────────────────────────────────────────────────────────────
out_pdf = r"C:\Users\hamad\Documents\car whased in Egypt redsea\STACK_CHEATSHEET.pdf"
doc = SimpleDocTemplate(
    out_pdf,
    pagesize=A4,
    leftMargin=2*cm, rightMargin=2*cm,
    topMargin=2*cm,  bottomMargin=2*cm
)

story = []

# ── TITLE ─────────────────────────────────────────────────────────────────────
story.append(Paragraph("STACK CHEATSHEET", title_style))
story.append(Paragraph(
    "When to use each of the 19 cloned repos — and how to talk to me",
    subtitle_style))
story.append(HRFlowable(width="100%", thickness=2, color=BLUE_RULE, spaceAfter=8))

story.append(Paragraph(
    "This is your personal cheat sheet for the open-source stack cloned at "
    "<b>C:\\Users\\hamad\\Downloads\\github open source\\</b>. "
    "Rule #1: don't name a specific repo when you talk to me. "
    "Describe the <b>NEED</b> and I'll pick the right tool automatically. "
    "Rule #2: this table is in my memory — I auto-load it every session.",
    intro_style))

# ── 1. SAAS BASE ──────────────────────────────────────────────────────────────
story.append(Paragraph("1. SaaS Base Layer", h1_style))
story.append(Paragraph("Start here for any new application project.", body_style))
story.append(Spacer(1, 4))

W = [3.2*cm, 5.5*cm, 4*cm, 3.8*cm, 5*cm]
story.append(build_table(
    ["Repo", "When to use", "When NOT to use", "Path", "What to say to me"],
    [
        ["SaaS-Boilerplate (ixartz)",
         "New multi-tenant SaaS. Drizzle, Stripe, Storybook, i18n already wired.",
         "Simple one-page app, internal tool",
         "01-saas-base/SaaS-Boilerplate",
         '"Build me a SaaS for X"'],
        ["saas-starter (nextjs)",
         "Quick Next.js + Stripe + Postgres. Simpler than Boilerplate.",
         "Need i18n or multi-tenancy",
         "01-saas-base/saas-starter",
         '"Quick Next.js app with Stripe"'],
        ["shadcn/ui",
         "Any React/Tailwind UI. Default for all UI work.",
         "Non-React stack (Vue, Svelte)",
         "01-saas-base/ui",
         "(auto — I just use it)"],
        ["Radix UI",
         "Accessible primitives: dialogs, dropdowns, tabs. Pairs with shadcn.",
         "Already have a UI lib",
         "01-saas-base/primitives",
         '"Need accessible dialog"'],
        ["Tailgrids",
         "Pre-built marketing blocks (hero, pricing, footer). Fallback only.",
         "shadcn has the block",
         "01-saas-base/tailgrids",
         '"I need a marketing landing page fast"'],
        ["Fumadocs",
         "Docs site for a project.",
         "Project doesn't need docs",
         "01-saas-base/fumadocs",
         '"Add docs site"'],
    ],
    W
))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Rule: New app → SaaS-Boilerplate or saas-starter. New UI → shadcn. Anything else → ask me.",
    rule_style))

# ── 2. OPS ────────────────────────────────────────────────────────────────────
story.append(Paragraph("2. Ops Layer — Production Infrastructure", h1_style))

story.append(build_table(
    ["Repo", "When to use", "When NOT to use", "Path", "What to say to me"],
    [
        ["PostHog",
         "Product analytics, funnels, feature flags, session replay, A/B tests. Use for ALL analytics.",
         "You only need server logs",
         "02-ops/posthog",
         '"Track conversion funnel" / "Add analytics"'],
        ["Langfuse",
         "Tracing LLM calls, prompt versions, evaluating AI outputs. Use for ANY project with LLM.",
         "Project has no AI",
         "02-ops/langfuse",
         '"Add observability for the agent"'],
        ["OpenObserve",
         "Logs/metrics/traces. Drop-in Datadog/Splunk replacement. Rust-based, Docker only.",
         "Just use hosted Langfuse or PostHog",
         "02-ops/openobserve",
         '"Need a Datadog alternative"'],
        ["Playwright",
         "E2E browser tests, booking flows, chat widgets, form submissions. Default for E2E in any web project.",
         "Pure API-only (no UI)",
         "02-ops/playwright",
         '"Add E2E tests for the booking flow"'],
    ],
    W
))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Rule: New project with LLM → Langfuse. Web project → Playwright E2E. Analytics → PostHog.",
    rule_style))

# ── 3. AGENTS ─────────────────────────────────────────────────────────────────
story.append(Paragraph("3. Agents Layer — AI Agent Frameworks", h1_style))
story.append(Paragraph(
    "⚠  Important: pick ONE framework. Don't mix.",
    warn_style))

story.append(build_table(
    ["Repo", "When to use", "When NOT to use", "Path", "What to say to me"],
    [
        ["Mastra ★ (DEFAULT)",
         "ALL TS agent projects. Modern, TS-first, memory, RAG, MCP, voice, workflows.",
         "You're locked into a different stack",
         "03-agents/mastra",
         '"Build me an AI agent for X"'],
        ["VoltAgent",
         "Only if you want voice/RAG-heavy platform with VoltAgent-specific patterns.",
         "Most cases",
         "03-agents/voltagent",
         '"Use VoltAgent instead of Mastra"'],
        ["OpenAI Agents JS",
         "Only if you must use OpenAI SDK directly.",
         "Most cases",
         "03-agents/openai-agents-js",
         "(rarely)"],
        ["Microsoft Agent FW",
         ".NET or Python projects.",
         "TS or JS projects",
         "03-agents/microsoft-agent-framework",
         '".NET agent for X"'],
        ["Google ADK",
         "Python projects that need Google's agent eval tooling.",
         "TS or JS",
         "03-agents/google-adk-python",
         '"Python agent for X"'],
        ["Mem0",
         "Long-term memory for agents. Remembering returning customers, conversation history across sessions.",
         "Single-session, stateless",
         "03-agents/mem0",
         '"Agent should remember returning customers"'],
    ],
    W
))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Rule: TS project → Mastra. Python → Google ADK. Need memory across sessions → Mem0 (adds to any framework).",
    rule_style))

# ── 4. PAYMENTS ───────────────────────────────────────────────────────────────
story.append(Paragraph("4. Payments", h1_style))

story.append(build_table(
    ["Repo", "When to use", "When NOT to use", "Path", "What to say to me"],
    [
        ["Polar",
         "Building a SaaS that needs subscriptions / payments.",
         "You're a service business, or you don't take money online",
         "04-payments/polar",
         '"Add subscriptions to my SaaS"'],
    ],
    W
))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Don't use Polar for your car wash. You take InstaPay / Vodafone Cash / Fawry, not card subs.",
    ParagraphStyle('PayWarn', fontName='Helvetica-Bold', fontSize=9,
                   textColor=RED_ACC, spaceAfter=8)))

# ── DECISION FLOW ─────────────────────────────────────────────────────────────
story.append(HRFlowable(width="100%", thickness=2, color=BLUE_RULE, spaceAfter=6))
story.append(Paragraph("Quick Decision Flow", h1_style))

flow_data = [
    ("Building a new project?",
     ["SaaS / multi-tenant → SaaS-Boilerplate",
      "Simple Next.js app → saas-starter",
      "Other → ask me"]),
    ("Adding UI?",
     ["shadcn/ui (auto — I just use it)"]),
    ("Adding LLM features?",
     ["Need agent that does things → Mastra",
      "Need to TRACE the LLM → Langfuse",
      "Need to REMEMBER across sessions → Mem0"]),
    ("Adding observability?",
     ["User behavior → PostHog",
      "LLM behavior → Langfuse",
      "Server logs → OpenObserve (Docker, last resort)",
      "Browser tests → Playwright"]),
    ("Adding docs?",
     ["Fumadocs"]),
    ("Need payments?",
     ["Polar (only if SaaS, not for service business)"]),
]

for title_text, items in flow_data:
    story.append(Paragraph(title_text, h2_style))
    for item in items:
        story.append(Paragraph(f"• {item}", bullet_style))
    story.append(Spacer(1, 4))

# ── GOOD / BAD EXAMPLES ───────────────────────────────────────────────────────
story.append(HRFlowable(width="100%", thickness=2, color=BLUE_RULE, spaceAfter=6))
story.append(Paragraph("What to say in chat — Good vs Bad examples", h1_style))

story.append(Paragraph("✅  Good (let me pick the right tool)", h2_style))
for ex in [
    '"Build me a SaaS for booking yoga classes"',
    '"Add analytics to the landing page"',
    '"Customers complain the chatbot forgets them"',
    '"Make a docs site for the API"',
    '"Test the booking flow end-to-end"',
]:
    story.append(Paragraph(f"• {ex}", bullet_style))

story.append(Paragraph("❌  Bad (don't name a specific repo)", h2_style))
for ex in ['"Use SaaS-Boilerplate"', '"Use Langfuse for the agent"', '"Use Mastra"']:
    story.append(Paragraph(f"• {ex}", bullet_style))

story.append(Spacer(1, 4))
story.append(Paragraph(
    "Exception: if you specifically want a different tool than I'd default to, name it. "
    'E.g. "Use VoltAgent instead of Mastra" — that\'s a real override.',
    ParagraphStyle('Exception', fontName='Helvetica-Oblique', fontSize=9,
                   textColor=TEXT_MID, spaceAfter=8)))

# ── ANY AI ────────────────────────────────────────────────────────────────────
story.append(HRFlowable(width="100%", thickness=2, color=BLUE_RULE, spaceAfter=6))
story.append(Paragraph("Will this work with any AI?", h1_style))
story.append(Paragraph(
    "Yes — the table is about tools, not models. Any AI (me, Codex, Hermes, Claude, GPT) "
    "that has access to the repos can use them. The agent memory I wrote auto-loads this table "
    "into my context every session, so I never forget. If you switch to a different AI, you'll "
    "need to give it the same stack catalog (or just paste this document into its context).",
    body_style))

# ── footer via page template ──────────────────────────────────────────────────
def add_footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 7)
    canvas.setFillColor(HexColor('#9CA3AF'))
    canvas.drawCentredString(
        PAGE_W / 2, 1.2*cm,
        "Stack Cheatsheet · Hamad's curated open-source stack · github open source/"
    )
    canvas.restoreState()

doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)
print(f"Saved: {out_pdf}")