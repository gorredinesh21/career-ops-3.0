# Resume Engine (LaTeX, matches Dinesh's real resume)

Ported from the CareerOS pattern (`JOB_APPLICATION_HANDLER-`): **structured JSON → LaTeX → `pdflatex`**.
Output is pixel-identical to `Desktop/GORRE_DINESH_CV.pdf` (Lato + FontAwesome, one-page project-centric).

## Files
- `base_resume.json` — canonical resume data (Dinesh's **new** resume: Talk-to-Genie/UnifiedGenie, CareerOS, GAN, **Tinder AI Coach**, real repo links). This is the source of truth — NOT the old `base_resume.json` in the CareerOS GitHub repo.
- `render.mjs` — builds the `.tex` (exact look) from the data and compiles it. Zero npm deps.
- `jobs/*.json` — per-job tailoring overrides (deep-merged onto base; arrays replace). Tailor `skills` order and `experience`/`projects` bullets. Facts (name, education, companies, titles, repo links) stay from base. **NO summary section** — the engine never renders one (keeps every resume to 1 page, matching the real CV); a `summary` key in a job JSON is ignored.

## Usage
```
node resume-engine/render.mjs                                   # base -> output/cv-...-base-<date>.pdf
node resume-engine/render.mjs --job resume-engine/jobs/razorpay-fde.json --name razorpay-fde
```
JSON string values are **raw LaTeX** (so `\textbf{}`, `$\rightarrow$` work). Escape literal `& % # _` yourself.

## Compiler
Uses **pdflatex** from **TinyTeX** (installed at `%APPDATA%\TinyTeX`). `render.mjs` auto-detects pdflatex/xelatex/latexmk/MiKTeX/TinyTeX; set `LATEX_COMPILER` to override.
- Add a missing package:  `%APPDATA%\TinyTeX\bin\windows\tlmgr.bat install <pkg>`  (e.g. `lato`).
- Corporate (Zscaler) note: `tinytex.yihui.org` is blocked, but the GitHub bundle and tlmgr's `tlnet.yihui.org` mirror work.
