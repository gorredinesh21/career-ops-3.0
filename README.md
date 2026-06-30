# career-ops-3.0

An AI job-search pipeline with a **coded LangChain engine**. It scans job
boards, fetches descriptions, filters by experience, **rates every job against
multiple resumes**, and **generates a heavily-tailored resume per job** —
choosing which of your GitHub projects to feature and rewriting skills/keywords
to match the JD.

> **Lineage:** career-ops-3.0 builds on the open-source MIT project
> [`career-ops`](https://github.com/santifer/career-ops) by
> [@santifer](https://santifer.io) (the scanning core, tracker, and dashboard).
> The intelligence layer here is reworked from agent-driven prompts into a
> coded **LangChain.js** pipeline (`lc/`), and the resume engine descends from
> the [CareerOS](https://github.com/gorredinesh21/JOB_APPLICATION_HANDLER-)
> pattern. See [`LICENSE`](./LICENSE) for attribution.

## Pipeline

```
scan (ATS APIs + LinkedIn/Apify)         existing, zero-LLM
        │
        ├─▶ lc/fetch-jd.mjs              fetch JD text for ATS jobs (Playwright)
        ▼
lc/filter-experience.mjs                 add min_experience_required, DROP > 3 yrs
        ▼
lc/rate-jobs.mjs                         rate /5 against EVERY resume,
                                         keep best score + which resume won
        ▼
lc/gen-resume.mjs                        tailored resume per job:
                                         picks projects from your GitHub catalog,
                                         rewrites skills/keywords (no fabrication)
        ▼
resume-engine/render.mjs                 JSON → LaTeX → PDF
        ▼
dashboard-web                            unchanged; reads data/eval-meta.json
```

## LLM backend

The LangChain layer (`lc/`) runs on **Ollama** (local, free, unlimited) by
default, or **Gemini** (cloud). Switch with `LLM_PROVIDER` in `.env`.

- **Ollama:** install from https://ollama.com, then `ollama pull llama3.1`.
- **Gemini:** set `LLM_PROVIDER=gemini` and add `GEMINI_API_KEY` (free tier is
  ~20 requests/day per model — fine for testing; enable billing for volume).

## Setup

```bash
npm install
cp .env.example .env          # set LLM_PROVIDER + key/model
```

## One-time inputs

```bash
# 1. Drop your resumes (.pdf/.md/.txt) in resume-engine/resumes/, then:
node lc/parse-resumes.mjs              # -> resume-engine/resumes/parsed/*.json

# 2. Build the project catalog from your GitHub:
node lc/build-project-catalog.mjs      # -> config/project-catalog.json
```

## Run the pipeline

```bash
# End-to-end on a scanned jobs file:
node lc/pipeline.mjs --in data/daily/<date>.json --min-score 3.5 --render

# Or stage by stage:
node lc/fetch-jd.mjs          --in output/scan-jobs-<date>.json   # ATS only
node lc/filter-experience.mjs --in <jobs.json>
node lc/rate-jobs.mjs         --in <filtered.json>                # -> data/eval-meta.json
node lc/gen-resume.mjs        --in <filtered.json> --min-score 3.5 --render
```

## Dashboard

```bash
node dashboard-web/server.mjs          # http://localhost:4317
```
The tracker schema is unchanged; ratings / best-resume / min-experience come
from the `data/eval-meta.json` sidecar via `/api/eval-meta` and the enriched
`/api/daily`.

## Ethics

Tailoring **reframes and reorders your real experience and projects** to match a
JD — it never invents skills, employers, or metrics. Quality over quantity;
always review before applying.

## License

MIT — see [`LICENSE`](./LICENSE).
