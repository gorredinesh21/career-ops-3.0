# User Profile Context -- career-ops

<!-- ============================================================
     THIS FILE IS YOURS. It will NEVER be auto-updated.
     The system reads _shared.md (updatable) first, then this
     file (your overrides). Your customizations always win.
     ============================================================ -->

## Hard Constraints (read FIRST, every evaluation)

**Experience ceiling — candidate has ~1 year of professional experience.**
Only surface and recommend roles whose **stated minimum required experience is ≤ 3 years.**

- When evaluating a JD, find the required-experience line ("X+ years", "minimum X years", "X-Y years"). If the **minimum is > 3 years**, score the role low (≤ 2.5/5) and recommend **SKIP** — unless the JD explicitly welcomes early-career / 0-2 yr / fresh-grad candidates, in which case judge on merit.
- Treat titles containing **Senior / Staff / Principal / Lead / Manager / Director / Head / VP / Architect** as above the ceiling by default, even if a number isn't stated, unless the JD body says otherwise.
- "II" / "Engineer II" / mid-level (2-4 yr) roles are borderline — acceptable if the stated minimum is ≤ 3 years.
- The portal title-scanner already filters most senior titles out, but JD-level experience is the real gate — always verify the number in the description.

## Discovery Sources & Pipeline Order (read before scan/pipeline)

Jobs enter the pipeline from **three** sources, then flow through the same stages:

1. **Telegram** (TechUprise channel) — companies auto-added to portals.yml.
2. **Company career sites** — `node scan.mjs` (zero-token ATS boards) + agent scan.
3. **Apify job scrapers** — `node apify-scan.mjs` (**LinkedIn only** right now;
   Naukri + All-Jobs are configured but disabled in portals.yml, Wellfound too).
   Run with `NODE_OPTIONS=--use-system-ca` (corporate proxy). Config + pricing
   live under `apify:` in portals.yml. Token in `.env` (`APIFY_TOKEN`).
   `--reset-today` rebuilds the current day; `--dry-run` previews.

**Order:** pull from all three → **dedupe** → **filter** (title + location + the
≤3-yr ceiling below) → **score** (A–G, X/5) → **tailored resume per job**.
Dedupe + the title/location filter happen automatically in `scan.mjs` /
`apify-scan.mjs` (they cross-check scan-history.tsv, pipeline.md, and
applications.md by a query-stripped URL key, so the three sources never
duplicate each other). Scoring and resume generation happen in
`/career-ops pipeline`.

**Daily table:** every scan also writes a per-day table to
`data/daily/<YYYY-MM-DD>.json` with the full LinkedIn columns (title, company,
location, seniority, type, salary, postedAt, applicants, applyUrl, …). Jobs from
Telegram / company sites fill only the columns they have. The web dashboard
(`node dashboard-web/server.mjs` → http://localhost:4317) shows this as a
"Daily jobs" table with a date picker (`/api/daily?date=…`).

## Resume Output — DATE-FOLDER LAYOUT (always)

When generating a tailored resume PDF, write it into a folder named for **today's
date** (YYYY-MM-DD):

```
output/<YYYY-MM-DD>/<company-slug>-<role-slug>.pdf
```

e.g. `output/2026-06-16/acme-ai-engineer.pdf`. So every day's resumes are grouped
in their own dated folder. `generate-pdf.mjs` auto-creates the dated folder, so
just pass the full path as the output argument:

```
node generate-pdf.mjs output/<company>.html output/<YYYY-MM-DD>/<company>-<role>.pdf
```

(`auto_pdf_score_threshold: 0` → a tailored resume is generated for EVERY
evaluated posting, so this keeps `output/` organized instead of one flat pile.)

## Acceptable Role Types

Internships **and** analyst / data-analyst roles **ARE in scope** (set 2026-06-10). Do NOT skip a role just for being an internship or carrying an "Analyst" title. Judge on domain fit (GenAI / ML / Data Eng / SWE / data-analytics) and the ≤3-yr experience ceiling — not on the role being an internship or analyst.

## Your Target Roles

| Archetype | Thematic axes | What they buy |
|-----------|---------------|---------------|
| **Generative AI / LLM Engineer** | RAG, LLM apps, prompt/eval, FastAPI, vector DBs | Someone who ships LLM features that work in production |
| **Agentic AI / Applied AI Engineer** | LangGraph, multi-agent, MCP, tool use, HITL | Someone who builds reliable agentic systems end-to-end |
| **Data Engineer (Databricks/Azure)** | PySpark, ADF, Delta, Bronze→Silver→Gold, warehousing | Someone who builds and runs production data pipelines |
| **Machine Learning Engineer** | Model training, CV/NLP, GANs, evaluation | Someone with real ML fundamentals, not just API calls |
| **AI Solutions / Forward Deployed Engineer** | Client-facing, fast prototyping, integrations | Someone who turns AI ideas into delivered systems fast |

## Your Adaptive Framing

| If the role is... | Emphasize about you... | Proof point sources |
|-------------------|------------------------|---------------------|
| GenAI / LLM Engineer | UnifiedGenie RAG (120+ tables, semantic routing), CareerOS multi-agent app, Tinder AI Coach (FastAPI + Gemini + RAG KB), FAISS/Chroma | cv.md |
| Agentic / Applied AI | CareerOS LangGraph multi-agent workflow, Tinder AI Coach (MCP), Talk-to-Genie OAuth web app | cv.md |
| Data Engineer | Databricks workflows, PySpark Silver→Gold, near-real-time ADF (15-min refresh), ADLS Gen2 | cv.md |
| ML Engineer | GAN augmentation (recall 0.91→0.99, 10M+ rows), multimodal Gemini photo analysis (Tinder AI Coach), Amazon ML Challenge top 200, IIT CSE | cv.md |
| Solutions / Forward Deployed | End-to-end delivery from data pipeline to LLM app; ships fast, breadth across the stack | cv.md + article-digest.md |

## Your Exit Narrative

IIT (ISM) Dhanbad CSE grad, ~1 year at Reliance Industries shipping production GenAI (RAG over 120+ tables past Genie's 30-table cap, OAuth Genie web app, semantic query routing) and near-real-time data pipelines (ADF, PySpark, Bronze→Silver→Gold). Looking to move into a role with **deeper GenAI/agentic ownership and a stronger engineering culture**.

- **In PDF Summaries:** Bridge from "built production GenAI + data platforms at a large enterprise" to "want deeper ownership of GenAI/agentic systems."
- **In STAR stories:** Lead with UnifiedGenie (scaling past the 30-table limit) and CareerOS (multi-agent).
- **In Draft Answers:** The transition narrative appears in the first response.

## Your Cross-cutting Advantage

**"Multi-disciplinary engineer who ships."** Genuine depth across GenAI (LangChain/LangGraph, RAG, agents, MCP), ML/DL (CV, NLP, GANs), and Data Engineering (Databricks, PySpark, ADF) — backed by IIT CSE fundamentals. Not a chatbot-wrapper builder: end-to-end pipelines and production systems.

## Your Portfolio / Demo

Live portfolio: https://portfolio-eight-coral-tabh47k4e7.vercel.app/ — share it in applications, especially for GenAI/AI Engineer roles. Projects also on GitHub (github.com/gorredinesh21). Consider building 2-3 more original GenAI projects with distinct architectures to strengthen it further.

## Your Comp Targets

- **Target:** ₹10L-18L total comp (annual)
- **Current CTC:** ₹9L (do NOT lead with this; anchor on role value + target instead)
- **Minimum / walk-away:** ₹12L (~30% hike over current)
- Use WebSearch (Glassdoor India, AmbitionBox, levels.fyi, LinkedIn Salary) for live ranges by role + city.
- Frame by role title (GenAI Engineer / Data Engineer), and weight the IIT pedigree + production GenAI experience.

## Your Negotiation Scripts

**Salary expectations:**
> "Based on market data for GenAI/Data Engineering roles at my level, I'm targeting [RANGE]. I'm flexible on structure — what matters is the total package, the scope of GenAI ownership, and the team."

**When asked for current CTC (common in India):**
> "I'd prefer to anchor on the role's market value and my fit rather than my current number. For roles at this scope I'm targeting [RANGE]."

**When offered below target:**
> "I'm weighing this against opportunities in the [higher range]. I'm genuinely drawn to [company] because of [reason] — can we explore [target]?"

## Your Location Policy

**In forms:**
- Based in Mumbai, India (IST). Open to Mumbai, Bengaluru, Hyderabad; remote preferred.
- Indian citizen — no sponsorship needed for India-based roles.

**In evaluations (scoring):**
- India-based remote/hybrid roles: score remote dimension **5.0**.
- On-site in target cities (Mumbai/Bengaluru/Hyderabad): score **4.0**.
- On-site elsewhere in India requiring relocation: score **3.0**.
- Only score 1.0 if it's an undesirable location with mandatory full on-site and no flexibility.
