# Evaluation: Ekkam BizTech Private Limited — AI Developer

**Date:** 2026-06-18
**URL:** https://in.linkedin.com/jobs/view/ai-developer-at-ekkam-biztech-private-limited-4429032145
**Archetype:** Machine Learning Engineer (hybrid Generative AI / LLM Engineer)
**Score:** 4.0/5
**Legitimacy:** Proceed with Caution
**PDF:** not generated — run /career-ops pdf ekkam-biztech to create on demand

---

## A) Role Summary

| Field | Value |
|---|---|
| Archetype | Machine Learning Engineer (+ GenAI/LLM as "preferred") |
| Domain | Applied ML / AI app development (broad, generalist) |
| Function | Build (train + deploy + integrate models) |
| Seniority | Entry / early-career — stated **1–3 years** |
| Remote | On-site, Chennai (no remote/hybrid stated) |
| Team size | Not mentioned |
| TL;DR | Broad early-career AI/ML build role at a small Chennai services/product shop; core ask is classic ML (TF/PyTorch/sklearn) with LLM/RAG as a bonus. |

## B) Match with CV

Core requirements map cleanly to the CV. The JD is generalist ("design, develop, deploy AI/ML solutions") so almost every line has a CV anchor.

| JD Requirement | CV Match |
|---|---|
| 1–3 yrs AI/ML development | ~1 yr at Reliance (Data/AI Engineer) — within ceiling (cv.md, Work Experience) |
| Python + TensorFlow/PyTorch/Scikit-learn | Python primary; PyTorch/TensorFlow/Keras (cv.md, Skills: ML/DL) |
| ML, Deep Learning, NLP, GenAI concepts | NLP, CNN, LSTM, BERT, Transformers, GANs (cv.md, Skills) |
| Train/deploy models, structured + unstructured data | GAN augmentation pipeline on 10M+ rows; recall 0.91→0.99 (cv.md, Projects) |
| Build AI-powered apps + APIs | CareerOS (Flask/LangChain), Tinder AI Coach (FastAPI) (cv.md, Projects) |
| Evaluate/optimize model performance | 5-fold CV across RF/XGBoost/LightGBM; false negatives down to 9 (cv.md) |
| REST APIs + database tech | FastAPI, Flask, PostgreSQL, SQLite (cv.md, Skills/Projects) |
| Preferred: LLMs, prompt eng, RAG, vector DBs, cloud, MLOps | UnifiedGenie RAG (120+ tables), FAISS/ChromaDB, Databricks/Azure/AWS (cv.md) |

**Gaps:**
1. **Production "AI Developer" at a tiny firm vs. enterprise GenAI** — not a skills gap; candidate is over-qualified on the GenAI side relative to the generalist JD. Mitigation: frame the breadth (ML + GenAI + DE) as the differentiator. Not a blocker.
2. **On-site Chennai** — Chennai is outside the stated target cities (Mumbai/Bengaluru/Hyderabad). Not a hard blocker but a relocation cost. Mitigation: confirm hybrid/remote flexibility before investing.
3. **No company specificity / domain** — JD is template-like (covered in Block G). Adjacent experience covers everything; no portfolio gap.

## C) Level and Strategy

1. **Level detected:** Entry / 1–3 yr. Candidate's natural level for this archetype (~1 yr, IIT CSE, production GenAI) sits comfortably inside the band — arguably top of it.
2. **Sell senior without lying:** Lead with the GAN project (real ML fundamentals, 10M+ rows, measurable recall lift) and UnifiedGenie (production RAG past Genie's 30-table cap). For a small shop this reads as "can own end-to-end ML + GenAI alone," which is exactly what generalist AI Developer roles need.
3. **If they downlevel me:** Title is already entry-level, so downleveling risk is low. The real lever is comp + location, not level. Accept only if comp clears the ₹12L walk-away and there is hybrid flexibility; otherwise this is a weaker option than Bengaluru/Hyderabad roles.

## D) Comp and Demand

No salary in JD. Live web research was not run in this batch; figures below are calibrated estimates flagged as such.

| Item | Estimate | Note |
|---|---|---|
| AI Developer, 1–3 yr, Chennai | ~₹6–14L (est.) | Small-firm Chennai band typically lower than Bengaluru/Hyderabad |
| Vs. target (₹10–18L) | Borderline | Could land below target; risk of sub-₹12L offer |
| Demand trend | High | AI Developer / GenAI roles in strong demand across India |

Estimates only — verify on AmbitionBox / Glassdoor India for "Ekkam BizTech" + role before negotiating. Small private firm comp is unpredictable; do not assume top quartile.

## E) Customization Plan

| # | Section | Current status | Proposed change | Why |
|---|---|---|---|---|
| 1 | Summary | DE/GenAI-led | Add a line on classic ML depth (GANs, XGBoost/LightGBM, eval) | JD core is traditional ML, not just LLMs |
| 2 | Projects | GAN project present | Surface GAN project to top; lead with recall 0.91→0.99 | Direct match to "train/evaluate/optimize models" |
| 3 | Skills | Full stack listed | Group TF/PyTorch/sklearn first | Mirror JD's required-skills order for ATS |
| 4 | Projects | CareerOS/Tinder | Emphasize REST API + DB integration | Matches "build/integrate AI apps and APIs" |
| 5 | Location line | Mumbai-based | State Chennai openness/hybrid ask explicitly | On-site Chennai needs addressing up front |

**LinkedIn:** (1) headline keep GenAI + ML; (2) add "TensorFlow/PyTorch/Scikit-learn" to skills; (3) pin GAN repo; (4) add RAG/vector-DB keywords; (5) note open to Chennai/hybrid if pursuing.

## F) Interview Plan

| # | JD Requirement | STAR+R Story | S | T | A | R | Reflection |
|---|---|---|---|---|---|---|---|
| 1 | Train/evaluate/optimize models | GAN augmentation | Imbalanced credit-card data, 10M+ rows | Cut false negatives | Custom GAN + SMOTE, 5-fold CV across 4 models | Recall 0.91→0.99, FN down to 9 | Synthetic data helps only when validated against real holdout |
| 2 | Build AI apps + APIs | CareerOS | Manual job-application workflow | Automate end-to-end | Flask + LangChain/LangGraph multi-agent | Tailored resumes per JD | Multi-agent orchestration needs guardrails to stay deterministic |
| 3 | GenAI / RAG (preferred) | UnifiedGenie | Genie's 30-table hard cap | Scale to 120+ tables | RAG framework, 9 spaces, semantic routing | Unlocked enterprise-wide Q&A | Metadata-driven routing beats one giant index |
| 4 | Structured + unstructured data | Near-real-time pipeline | Stale reporting data | 15-min refresh | ADF Landing→Bronze→Silver | Fresh data for downstream models | Incremental loads beat full refresh at scale |
| 5 | Deploy/monitor in production | Talk-to-Genie web app | Genie locked inside Databricks | Secure external access | OAuth web app | Conversational access outside Databricks | Auth is the hardest part of "just expose it" |
| 6 | Multimodal / NLP | Tinder AI Coach | Inconsistent profiles | Standardize + advise | Gemini multimodal + RAG KB | Actionable photo/bio feedback | Grounding advice in a local KB cuts generic output |

- **Recommended case study:** GAN augmentation project — strongest "real ML, not API calls" signal, directly matches the JD's model-training core.
- **Red-flag Qs:** "Why leave Reliance after a year?" → want deeper GenAI ownership + stronger eng culture. "Open to Chennai on-site?" → answer honestly; gauge hybrid flexibility.

## G) Posting Legitimacy

**Assessment: Proceed with Caution**

| Signal | Finding | Weight |
|---|---|---|
| Posting freshness | LinkedIn listing, active job ID; exact age not captured in batch | Neutral |
| Tech specificity | Generic, template-like JD (standard stack list, no project/domain detail) | Concerning |
| Requirements realism | Coherent and realistic for 1–3 yr; no contradictions | Positive |
| 6–12 month scope | Not described | Concerning |
| Company info | Small/low-profile firm; little public footprint | Neutral |
| Salary transparency | Absent (common in India) | Neutral |
| Reposting | Not checked against scan-history this batch | Neutral |

**Context Notes:** The JD reads like a reusable AI Developer template rather than a role written for a specific team — common at small services firms and not by itself a ghost-job indicator. Requirements are realistic and internally consistent. Verify the posting is live (Playwright/manual) and confirm location flexibility before investing time.

---

## Keywords extracted
AI Developer, Machine Learning, Deep Learning, NLP, Generative AI, Python, TensorFlow, PyTorch, Scikit-learn, model training, model deployment, data preprocessing, REST API, RAG, prompt engineering, vector databases, cloud, MLOps, LLM, evaluation

## Machine Summary
```yaml
company: Ekkam BizTech Private Limited
role: AI Developer
score: 4.0
archetype: Machine Learning Engineer
recommend: apply
legitimacy: Proceed with Caution
key_reason: Generalist 1-3 yr AI/ML build role that maps cleanly to the CV (GAN/ML depth + GenAI bonus) and sits inside the experience ceiling; held back by generic template JD, on-site Chennai outside target cities, and likely lower small-firm comp.
```
