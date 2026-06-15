from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
import os

# ── helpers ─────────────────────────────────────────────────────────────────

def set_cell_bg(cell, hex_color):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_color)
    tcPr.append(shd)

def add_page_border(doc):
    """Add a subtle coloured border to every page via section properties."""
    for section in doc.sections:
        sectPr = section._sectPr
        pgBorders = OxmlElement('w:pgBorders')
        pgBorders.set(qn('w:offsetFrom'), 'page')
        for edge in ('top', 'left', 'bottom', 'right'):
            b = OxmlElement(f'w:{edge}')
            b.set(qn('w:val'), 'single')
            b.set(qn('w:sz'), '6')
            b.set(qn('w:space'), '24')
            b.set(qn('w:color'), '2563EB')
            pgBorders.append(b)
        sectPr.insert(0, pgBorders)

def add_horizontal_rule(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after  = Pt(2)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '4')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), '2563EB')
    pBdr.append(bottom)
    pPr.append(pBdr)
    return p

# ── colours ─────────────────────────────────────────────────────────────────

BLUE_DARK  = RGBColor(0x1E, 0x40, 0xAF)   # deep blue
BLUE_MID   = RGBColor(0x25, 0x63, 0xEB)   # accent
BLUE_LIGHT = RGBColor(0xDB, 0xE8, 0xFE)   # header row bg
GRAY_LIGHT = RGBColor(0xF3, 0xF4, 0xF6)   # alt row bg
WHITE      = RGBColor(0xFF, 0xFF, 0xFF)
TEXT_DARK  = RGBColor(0x11, 0x11, 0x11)
GREEN_ACC  = RGBColor(0x16, 0xA3, 0x4A)
RED_ACC    = RGBColor(0xDC, 0x26, 0x26)

# ── document ────────────────────────────────────────────────────────────────

doc = Document()

# margins
for section in doc.sections:
    section.top_margin    = Cm(2)
    section.bottom_margin = Cm(2)
    section.left_margin   = Cm(2.5)
    section.right_margin  = Cm(2.5)

add_page_border(doc)

# ── TITLE ──────────────────────────────────────────────────────────────────

title = doc.add_paragraph()
title.alignment = WD_ALIGN_PARAGRAPH.CENTER
title.paragraph_format.space_before = Pt(6)
title.paragraph_format.space_after  = Pt(2)
run = title.add_run("STACK CHEATSHEET")
run.bold = True
run.font.size = Pt(26)
run.font.color.rgb = BLUE_DARK

sub = doc.add_paragraph()
sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
sub.paragraph_format.space_after = Pt(2)
run2 = sub.add_run("When to use each of the 19 cloned repos — and how to talk to me")
run2.font.size = Pt(11)
run2.font.color.rgb = RGBColor(0x6B, 0x72, 0x80)
run2.italic = True

add_horizontal_rule(doc)

# ── INTRO ──────────────────────────────────────────────────────────────────

intro = doc.add_paragraph()
intro.paragraph_format.space_before = Pt(4)
intro.paragraph_format.space_after  = Pt(8)
r = intro.add_run(
    "This is your personal cheat sheet for the open-source stack cloned at "
    "C:\\Users\\hamad\\Downloads\\github open source\\. "
    "Rule #1: don't name a specific repo when you talk to me. "
    "Describe the NEED and I'll pick the right tool automatically. "
    "Rule #2: the table is in my memory — I auto-load it every session."
)
r.font.size = Pt(10)
r.font.color.rgb = TEXT_DARK

# ── SECTION helper ─────────────────────────────────────────────────────────

def section_heading(doc, text):
    h = doc.add_heading(level=1)
    h.paragraph_format.space_before = Pt(12)
    h.paragraph_format.space_after  = Pt(4)
    run = h.add_run(text)
    run.bold = True
    run.font.size = Pt(14)
    run.font.color.rgb = BLUE_DARK
    return h

def sub_heading(doc, text):
    h = doc.add_heading(level=2)
    h.paragraph_format.space_before = Pt(6)
    h.paragraph_format.space_after  = Pt(2)
    run = h.add_run(text)
    run.bold = True
    run.font.size = Pt(11)
    run.font.color.rgb = BLUE_MID
    return h

def body(doc, text, italic=False, color=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(1)
    r = p.add_run(text)
    r.font.size = Pt(10)
    r.italic = italic
    if color:
        r.font.color.rgb = color
    else:
        r.font.color.rgb = TEXT_DARK
    return p

def bullet(doc, text, bold_prefix=None):
    p = doc.add_paragraph(style='List Bullet')
    p.paragraph_format.space_before = Pt(1)
    p.paragraph_format.space_after  = Pt(1)
    if bold_prefix:
        rb = p.add_run(bold_prefix)
        rb.bold = True
        rb.font.size = Pt(10)
        rb.font.color.rgb = BLUE_MID
        p.add_run(text).font.size = Pt(10)
    else:
        r = p.add_run(text)
        r.font.size = Pt(10)
    return p

# ── 1. SAAS BASE LAYER ─────────────────────────────────────────────────────

section_heading(doc, "1. SaaS Base Layer")

body(doc, "Start here for any new application project.", italic=True)

# Table
t1 = doc.add_table(rows=1, cols=5)
t1.style = 'Table Grid'
t1.autofit = True

hdr = ["Repo", "When to use", "When NOT to use", "Path", "What to say to me"]
for i, h in enumerate(hdr):
    cell = t1.rows[0].cells[i]
    cell.text = h
    set_cell_bg(cell, '1E40AF')
    for para in cell.paragraphs:
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in para.runs:
            run.bold = True
            run.font.color.rgb = WHITE
            run.font.size = Pt(9)

rows_saas = [
    ["SaaS-Boilerplate\n(ixartz)",
     "New multi-tenant SaaS. Drizzle, Stripe, Storybook, i18n already wired",
     "Simple one-page app, internal tool",
     "01-saas-base/\nSaaS-Boilerplate",
     '"Build me a SaaS for X"'],
    ["saas-starter\n(nextjs)",
     "Quick Next.js + Stripe + Postgres. Simpler than Boilerplate",
     "Need i18n or multi-tenancy",
     "01-saas-base/\nsaas-starter",
     '"Quick Next.js app with Stripe"'],
    ["shadcn/ui",
     "Any React/Tailwind UI. Default for all UI work",
     "Non-React stack (Vue, Svelte)",
     "01-saas-base/ui",
     "(auto — I just use it)"],
    ["Radix UI",
     "Accessible primitives: dialogs, dropdowns, tabs. Pairs with shadcn",
     "Already have a UI lib",
     "01-saas-base/primitives",
     '"Need accessible dialog"'],
    ["Tailgrids",
     "Pre-built marketing blocks (hero, pricing, footer). Fallback only",
     "shadcn has the block",
     "01-saas-base/tailgrids",
     '"I need a marketing landing page fast"'],
    ["Fumadocs",
     "Docs site for a project",
     "Project doesn't need docs",
     "01-saas-base/fumadocs",
     '"Add docs site"'],
]

for idx, row_data in enumerate(rows_saas):
    row = t1.add_row()
    bg = 'F3F4F6' if idx % 2 == 0 else 'FFFFFF'
    for i, cell_text in enumerate(row_data):
        cell = row.cells[i]
        cell.text = cell_text
        set_cell_bg(cell, bg)
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(9)

body(doc, "")
rule_note = doc.add_paragraph()
rule_note.paragraph_format.space_before = Pt(2)
rule_note.paragraph_format.space_after  = Pt(8)
rn = rule_note.add_run("Rule: New app → SaaS-Boilerplate or saas-starter. New UI → shadcn. Anything else → ask me.")
rn.bold = True
rn.font.size = Pt(10)
rn.font.color.rgb = BLUE_MID

# ── 2. OPS LAYER ───────────────────────────────────────────────────────────

section_heading(doc, "2. Ops Layer (Production Infrastructure)")

t2 = doc.add_table(rows=1, cols=5)
t2.style = 'Table Grid'

hdr2 = ["Repo", "When to use", "When NOT to use", "Path", "What to say to me"]
for i, h in enumerate(hdr2):
    cell = t2.rows[0].cells[i]
    cell.text = h
    set_cell_bg(cell, '1E40AF')
    for para in cell.paragraphs:
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in para.runs:
            run.bold = True
            run.font.color.rgb = WHITE
            run.font.size = Pt(9)

rows_ops = [
    ["PostHog",
     "Product analytics, funnels, feature flags, session replay, A/B tests. Use for ALL analytics",
     "You only need server logs",
     "02-ops/posthog",
     '"Track conversion funnel" / "Add analytics"'],
    ["Langfuse",
     "Tracing LLM calls, prompt versions, evaluating AI outputs. Use for ANY project with LLM",
     "Project has no AI",
     "02-ops/langfuse",
     '"Add observability for the agent"'],
    ["OpenObserve",
     "Logs/metrics/traces. Drop-in Datadog/Splunk replacement. Rust-based, Docker only",
     "Just use hosted Langfuse or PostHog",
     "02-ops/openobserve",
     '"Need a Datadog alternative"'],
    ["Playwright",
     "E2E browser tests, booking flows, chat widgets, form submissions. Default for E2E in any web project",
     "Pure API-only (no UI)",
     "02-ops/playwright",
     '"Add E2E tests for the booking flow"'],
]

for idx, row_data in enumerate(rows_ops):
    row = t2.add_row()
    bg = 'F3F4F6' if idx % 2 == 0 else 'FFFFFF'
    for i, cell_text in enumerate(row_data):
        cell = row.cells[i]
        cell.text = cell_text
        set_cell_bg(cell, bg)
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(9)

body(doc, "")
rule_note2 = doc.add_paragraph()
rule_note2.paragraph_format.space_before = Pt(2)
rule_note2.paragraph_format.space_after  = Pt(8)
rn2 = rule_note2.add_run("Rule: New project with LLM → Langfuse. Web project → Playwright E2E. Analytics → PostHog.")
rn2.bold = True
rn2.font.size = Pt(10)
rn2.font.color.rgb = BLUE_MID

# ── 3. AGENTS LAYER ────────────────────────────────────────────────────────

section_heading(doc, "3. Agents Layer (AI Agent Frameworks)")

p_warn = doc.add_paragraph()
p_warn.paragraph_format.space_after = Pt(6)
rw = p_warn.add_run("⚠  Important: pick ONE framework. Don't mix.")
rw.bold = True
rw.font.size = Pt(10)
rw.font.color.rgb = RED_ACC

t3 = doc.add_table(rows=1, cols=5)
t3.style = 'Table Grid'

hdr3 = ["Repo", "When to use", "When NOT to use", "Path", "What to say to me"]
for i, h in enumerate(hdr3):
    cell = t3.rows[0].cells[i]
    cell.text = h
    set_cell_bg(cell, '1E40AF')
    for para in cell.paragraphs:
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in para.runs:
            run.bold = True
            run.font.color.rgb = WHITE
            run.font.size = Pt(9)

rows_agents = [
    ["Mastra ★",
     "DEFAULT for ALL TS agent projects. Modern, TS-first, memory, RAG, MCP, voice, workflows",
     "You're locked into a different stack",
     "03-agents/mastra",
     '"Build me an AI agent for X"'],
    ["VoltAgent",
     "Only if you want voice/RAG-heavy platform with VoltAgent-specific patterns",
     "Most cases",
     "03-agents/voltagent",
     '"Use VoltAgent instead of Mastra"'],
    ["OpenAI Agents JS",
     "Only if you must use OpenAI SDK directly",
     "Most cases",
     "03-agents/openai-agents-js",
     "(rarely)"],
    ["Microsoft Agent FW",
     ".NET or Python projects",
     "TS or JS projects",
     "03-agents/microsoft-agent-framework",
     '".NET agent for X"'],
    ["Google ADK",
     "Python projects that need Google's agent eval tooling",
     "TS or JS",
     "03-agents/google-adk-python",
     '"Python agent for X"'],
    ["Mem0",
     "Long-term memory for agents. Remembering returning customers, conversation history across sessions",
     "Single-session, stateless",
     "03-agents/mem0",
     '"Agent should remember returning customers"'],
]

for idx, row_data in enumerate(rows_agents):
    row = t3.add_row()
    bg = 'F3F4F6' if idx % 2 == 0 else 'FFFFFF'
    for i, cell_text in enumerate(row_data):
        cell = row.cells[i]
        cell.text = cell_text
        set_cell_bg(cell, bg)
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(9)

body(doc, "")
rule_note3 = doc.add_paragraph()
rule_note3.paragraph_format.space_before = Pt(2)
rule_note3.paragraph_format.space_after  = Pt(8)
rn3 = rule_note3.add_run("Rule: TS project → Mastra. Python → Google ADK. Need memory across sessions → Mem0 (adds to any framework).")
rn3.bold = True
rn3.font.size = Pt(10)
rn3.font.color.rgb = BLUE_MID

# ── 4. PAYMENTS ────────────────────────────────────────────────────────────

section_heading(doc, "4. Payments")

t4 = doc.add_table(rows=1, cols=5)
t4.style = 'Table Grid'

hdr4 = ["Repo", "When to use", "When NOT to use", "Path", "What to say to me"]
for i, h in enumerate(hdr4):
    cell = t4.rows[0].cells[i]
    cell.text = h
    set_cell_bg(cell, '1E40AF')
    for para in cell.paragraphs:
        para.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for run in para.runs:
            run.bold = True
            run.font.color.rgb = WHITE
            run.font.size = Pt(9)

rows_pay = [
    ["Polar",
     "Building a SaaS that needs subscriptions / payments",
     "You're a service business, or you don't take money online",
     "04-payments/polar",
     '"Add subscriptions to my SaaS"'],
]
for idx, row_data in enumerate(rows_pay):
    row = t4.add_row()
    for i, cell_text in enumerate(row_data):
        cell = row.cells[i]
        cell.text = cell_text
        set_cell_bg(cell, 'F3F4F6')
        for para in cell.paragraphs:
            for run in para.runs:
                run.font.size = Pt(9)

body(doc, "")
note_pay = doc.add_paragraph()
note_pay.paragraph_format.space_after = Pt(10)
np = note_pay.add_run("Don't use Polar for your car wash. You take InstaPay / Vodafone Cash / Fawry, not card subs.")
np.bold = True
np.font.size = Pt(10)
np.font.color.rgb = RED_ACC

# ── DECISION FLOW ──────────────────────────────────────────────────────────

add_horizontal_rule(doc)
section_heading(doc, "Quick Decision Flow")

flow_blocks = [
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

for title_text, items in flow_blocks:
    sub_heading(doc, title_text)
    for item in items:
        bullet(doc, item)

# ── WHAT TO SAY ────────────────────────────────────────────────────────────

add_horizontal_rule(doc)
section_heading(doc, "What to say in chat — Good vs Bad examples")

sub_heading(doc, "✅  Good (let me pick the right tool)")

good_examples = [
    '"Build me a SaaS for booking yoga classes"',
    '"Add analytics to the landing page"',
    '"Customers complain the chatbot forgets them"',
    '"Make a docs site for the API"',
    '"Test the booking flow end-to-end"',
]
for ex in good_examples:
    bullet(doc, ex)

sub_heading(doc, "❌  Bad (don't name a specific repo)")
bad_examples = [
    '"Use SaaS-Boilerplate"',
    '"Use Langfuse for the agent"',
    '"Use Mastra"',
]
for ex in bad_examples:
    bullet(doc, ex)

note_override = doc.add_paragraph()
note_override.paragraph_format.space_before = Pt(4)
note_override.paragraph_format.space_after  = Pt(8)
no = note_override.add_run(
    "Exception: if you specifically want a different tool than I'd default to, name it. "
    'E.g. "Use VoltAgent instead of Mastra" — that\'s a real override.'
)
no.font.size = Pt(10)
no.italic = True
no.font.color.rgb = TEXT_DARK

# ── ANY AI? ────────────────────────────────────────────────────────────────

add_horizontal_rule(doc)
section_heading(doc, "Will this work with any AI?")

body(doc,
     "Yes — the table is about tools, not models. Any AI (me, Codex, Hermes, Claude, GPT) "
     "that has access to the repos can use them. The agent memory I wrote auto-loads this table "
     "into my context every session, so I never forget. If you switch to a different AI, you'll "
     "need to give it the same stack catalog (or just paste this document into its context).")

# ── FOOTER ─────────────────────────────────────────────────────────────────

footer = doc.sections[0].footer
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
fr = fp.add_run("Stack Cheatsheet · Hamad's curated open-source stack · github open source/")
fr.font.size = Pt(8)
fr.font.color.rgb = RGBColor(0x9C, 0xA3, 0xAF)

# ── SAVE ───────────────────────────────────────────────────────────────────

out_dir = os.path.dirname(os.path.abspath(__file__))
out_docx = os.path.join(out_dir, "STACK_CHEATSHEET.docx")
doc.save(out_docx)
print(f"Saved: {out_docx}")