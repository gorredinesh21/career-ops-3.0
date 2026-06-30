#!/usr/bin/env node
/**
 * lc/gen-resume.mjs — Stage 4: generate a heavily-tailored resume per job.
 *
 * For each job above a score threshold, takes the winning resume (from
 * data/eval-meta.json) as the base, the GitHub project catalog as the project
 * pool, and the JD — then asks the LLM to produce a full tailored resume JSON:
 *   - keeps real identity/education/experience facts (no fabrication),
 *   - PICKS the most relevant projects from the catalog,
 *   - rewrites skills + bullets to surface the JD's real keywords,
 *   - emits LaTeX-safe strings for resume-engine/render.mjs.
 *
 * Output: resume-engine/jobs/<slug>.json  (+ optional PDF with --render)
 *
 * Usage:
 *   node lc/gen-resume.mjs --in tmp/filtered.json --min-score 3.5
 *   node lc/gen-resume.mjs --in tmp/filtered.json --render
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildJsonChain, invokeWithRetry } from './llm.mjs';
import { ResumeSchema } from './schemas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PARSED_DIR = path.join(ROOT, 'resume-engine', 'resumes', 'parsed');
const JOBS_DIR = path.join(ROOT, 'resume-engine', 'jobs');
const CATALOG_PATH = path.join(ROOT, 'config', 'project-catalog.json');
const META_PATH = path.join(ROOT, 'data', 'eval-meta.json');

const GEN_PROMPT = `You are an elite resume writer. Produce ONE heavily-tailored, ATS-optimized resume
for the SPECIFIC job below. Output ONLY JSON matching this exact shape:

{{
  "name": string, "phone": string, "email": string,
  "github": string, "github_display": "GitHub",
  "portfolio": string, "portfolio_display": "Portfolio",
  "education": [{{ "institute": string, "degree": string, "duration": string, "location": string, "details": [string] }}],
  "experience": [{{ "role": string, "company": string, "duration": string, "location": string, "points": [string] }}],
  "projects": [{{ "title": string, "tech_stack": string, "repo_link": string, "points": [string] }}],
  "skills": [{{ "category": string, "items": string }}],
  "achievements": [string]
}}

NON-NEGOTIABLE RULES:
1. TRUTH: Keep identity, education, and the candidate's real companies/titles/durations EXACTLY as in BASE RESUME. Never invent employers, degrees, dates, or metrics.
2. HEAVY TAILORING (this is the point): aggressively rewrite EXPERIENCE bullets and SKILLS to mirror the JD's real language and priorities — but only using skills/work the candidate genuinely has (present in BASE RESUME or PROJECT CATALOG). Reframing real work is good; fabricating is forbidden.
3. PROJECT SELECTION: choose the 3-4 MOST RELEVANT projects for THIS JD from the PROJECT CATALOG (and base resume). Prefer 'flagship'/'solid' tier. Use the catalog's bullets/tech as source material, rewritten to match the JD. Always include each chosen project's repo_link.
4. SKILLS: reorder and group so the JD's must-have skills the candidate actually has appear first. Only list technologies with DIRECT evidence in BASE RESUME or PROJECT CATALOG. NEVER add hedged/guessed skills — no "(implied by ...)", no "familiar with", no inferring a cloud provider from a tool. If it's not clearly evidenced, leave it out.
5. KEYWORDS: weave the JD's key terms naturally into bullets and skills where truthful.
6. FORMAT: values are RAW LaTeX. Escape literal & % # _ as \\& \\% \\# \\_. You may use \\textbf{{}} and $\\rightarrow$. Keep it to ONE page: max 4 projects, max 4 bullets each, tight wording.

JOB:
- Title: {title}
- Company: {company}
- Description:
{jd}

BASE RESUME (the winning resume for this job — source of truth for facts):
{base}

PROJECT CATALOG (pool to pick projects from):
{catalog}`;

function compactCatalog(cat) {
  return (cat.projects || [])
    .map((p) => ({
      name: p.name, tech_stack: p.tech_stack, one_liner: p.one_liner,
      bullets: p.bullets, domains: p.domains, tier: p.tier, repo_link: p.repo_link,
    }));
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'job';
}

async function main() {
  const args = process.argv.slice(2);
  let inPath = null, minScore = 3.5, doRender = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in') inPath = args[++i];
    else if (args[i] === '--min-score') minScore = Number(args[++i]);
    else if (args[i] === '--render') doRender = true;
    else if (!args[i].startsWith('--') && !inPath) inPath = args[i];
  }
  if (!inPath || !existsSync(inPath)) {
    console.error('Usage: node lc/gen-resume.mjs --in <jobs.json> [--min-score 3.5] [--render]');
    process.exit(1);
  }
  if (!existsSync(CATALOG_PATH)) {
    console.error('Missing config/project-catalog.json — run `node lc/build-project-catalog.mjs` first.');
    process.exit(1);
  }
  if (!existsSync(META_PATH)) {
    console.error('Missing data/eval-meta.json — run `node lc/rate-jobs.mjs` first.');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(inPath, 'utf-8'));
  const jobs = Array.isArray(raw) ? raw : raw.jobs || [];
  const catalog = compactCatalog(JSON.parse(readFileSync(CATALOG_PATH, 'utf-8')));
  const meta = JSON.parse(readFileSync(META_PATH, 'utf-8'));

  const chain = buildJsonChain({
    template: GEN_PROMPT,
    inputVariables: ['title', 'company', 'jd', 'base', 'catalog'],
    schema: ResumeSchema,
    kind: 'resume',
  });

  mkdirSync(JOBS_DIR, { recursive: true });
  let made = 0;

  for (const job of jobs) {
    const key = job.url || `${job.company}::${job.title}`;
    const m = meta[key];
    if (!m) { continue; }
    if ((m.best_score ?? 0) < minScore) {
      console.log(`• skip (${m.best_score}/5 < ${minScore}): ${job.company} — ${job.title}`);
      continue;
    }
    const basePath = path.join(PARSED_DIR, `${m.best_resume}.json`);
    if (!existsSync(basePath)) { console.log(`• skip (no base resume ${m.best_resume}): ${job.title}`); continue; }
    const base = JSON.parse(readFileSync(basePath, 'utf-8'));
    const jd = job.descriptionText || job.description || job.raw_source_text || '';

    process.stdout.write(`• generating (${m.best_score}/5, base ${m.best_resume}): ${job.company} — ${job.title} ... `);
    let tailored;
    try {
      tailored = await invokeWithRetry(chain, {
        title: job.title || 'N/A',
        company: job.company || 'N/A',
        jd: jd.slice(0, 9000),
        base: JSON.stringify(base).slice(0, 9000),
        catalog: JSON.stringify(catalog).slice(0, 9000),
      });
    } catch (e) {
      console.log(`FAILED: ${e.message.slice(0, 140)}`);
      continue;
    }

    const name = `${slug(job.company)}-${slug(job.title)}`;
    const outFile = path.join(JOBS_DIR, `${name}.json`);
    writeFileSync(outFile, JSON.stringify(tailored, null, 2), 'utf-8');
    made++;
    console.log(`ok → resume-engine/jobs/${name}.json (${tailored.projects?.length || 0} projects)`);

    if (doRender) {
      const r = spawnSync(process.execPath, [path.join(ROOT, 'resume-engine', 'render.mjs'), '--job', outFile, '--name', name], { cwd: ROOT, encoding: 'utf-8' });
      const out = (r.stdout || '') + (r.stderr || '');
      console.log('   ' + out.trim().split('\n').slice(-2).join('\n   '));
    }
  }

  console.log(`\n✅ generated ${made} tailored resume(s) → resume-engine/jobs/${doRender ? ' (+ PDFs in output/)' : ''}`);
  if (!doRender && made) console.log('   Render any with: node resume-engine/render.mjs --job resume-engine/jobs/<name>.json --name <name>');
}

main().catch((e) => {
  console.error('\n❌ gen-resume failed:', e.message);
  process.exit(1);
});
