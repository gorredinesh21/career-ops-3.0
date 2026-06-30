#!/usr/bin/env node
/**
 * lc/rate-jobs.mjs — Stage 3: rate each job against EVERY resume (out of 5).
 *
 * For each job, runs the rating chain once per parsed resume, keeps the BEST
 * score, and records which resume won. Results go to a sidecar
 * (data/eval-meta.json) keyed by job URL — the 2.0 tracker/dashboard schema
 * stays untouched; the dashboard reads this file as an enrichment.
 *
 * Inputs:
 *   --in <jobs.json>   normalized + experience-filtered jobs (need a JD field)
 *   resume-engine/resumes/parsed/*.json  (from lc/parse-resumes.mjs)
 *
 * Usage:
 *   node lc/rate-jobs.mjs --in tmp/filtered-2026-06-18.json
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildJsonChain, invokeWithRetry } from './llm.mjs';
import { RatingSchema } from './schemas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PARSED_DIR = path.join(ROOT, 'resume-engine', 'resumes', 'parsed');
const META_PATH = path.join(ROOT, 'data', 'eval-meta.json');

const RATING_PROMPT = `You are an expert technical recruiter scoring how likely this candidate is to be
shortlisted for a job, based ONLY on their resume vs the job description.

Return ONLY compact JSON (no markdown fences, keep it short to avoid truncation):
{{
  "score": number,        // 0.0 - 5.0, one decimal. 5 = near-perfect fit, 3 = plausible, <2 = weak
  "verdict": "strong" | "good" | "stretch" | "weak",
  "matched": [string],    // max 4 SHORT phrases (3-6 words) the resume clearly meets
  "gaps": [string],       // max 4 SHORT phrases (3-6 words) missing/weak in the resume
  "reason": string        // ONE short sentence
}}

Scoring guidance:
- Weigh must-have skills, domain match, and seniority fit most heavily.
- Do not reward keyword stuffing; judge real evidence in the resume.
- Be calibrated and honest — a 5 should be rare.

JOB:
- Title: {title}
- Company: {company}
- Min experience required (years, null=unstated): {min_exp}
- Description:
{jd}

CANDIDATE RESUME (resume id: {resume_id}):
{resume}`;

function loadResumes() {
  if (!existsSync(PARSED_DIR)) return [];
  const files = readdirSync(PARSED_DIR).filter((f) => f.endsWith('.json') && f !== 'index.json');
  return files.map((f) => ({
    id: path.basename(f, '.json'),
    data: JSON.parse(readFileSync(path.join(PARSED_DIR, f), 'utf-8')),
  }));
}

// Compact a resume JSON into a token-efficient text blob for scoring.
function resumeToText(r) {
  const lines = [];
  if (r.name) lines.push(r.name);
  for (const e of r.experience || []) {
    lines.push(`EXP: ${e.role} @ ${e.company} (${e.duration})`);
    for (const p of e.points || []) lines.push(`  - ${p}`);
  }
  for (const p of r.projects || []) {
    lines.push(`PROJECT: ${p.title} [${p.tech_stack}]`);
    for (const b of p.points || []) lines.push(`  - ${b}`);
  }
  for (const s of r.skills || []) lines.push(`SKILLS ${s.category}: ${s.items}`);
  if (r.education?.length) lines.push(`EDU: ${r.education.map((e) => `${e.degree}, ${e.institute}`).join('; ')}`);
  return lines.join('\n');
}

function jobKey(job) {
  return job.url || `${job.company}::${job.title}`;
}

async function main() {
  const args = process.argv.slice(2);
  let inPath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in') inPath = args[++i];
    else if (!args[i].startsWith('--') && !inPath) inPath = args[i];
  }
  if (!inPath || !existsSync(inPath)) {
    console.error('Usage: node lc/rate-jobs.mjs --in <jobs.json>');
    process.exit(1);
  }

  const resumes = loadResumes();
  if (resumes.length === 0) {
    console.error('No parsed resumes found. Run `node lc/parse-resumes.mjs` first.');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(inPath, 'utf-8'));
  const jobs = Array.isArray(raw) ? raw : raw.jobs || [];
  console.log(`Rating ${jobs.length} jobs × ${resumes.length} resumes (${resumes.map((r) => r.id).join(', ')})\n`);

  const chain = buildJsonChain({
    template: RATING_PROMPT,
    inputVariables: ['title', 'company', 'min_exp', 'jd', 'resume_id', 'resume'],
    schema: RatingSchema,
    kind: 'rating',
  });

  const meta = existsSync(META_PATH) ? JSON.parse(readFileSync(META_PATH, 'utf-8')) : {};

  for (const job of jobs) {
    const jd = job.descriptionText || job.description || job.raw_source_text || '';
    if (!jd) {
      console.log(`• SKIP (no JD): ${job.company} — ${job.title}`);
      continue;
    }
    const perResume = [];
    for (const r of resumes) {
      try {
        const out = await invokeWithRetry(chain, {
          title: job.title || 'N/A',
          company: job.company || 'N/A',
          min_exp: job.min_experience_required ?? 'null',
          jd: jd.slice(0, 8000),
          resume_id: r.id,
          resume: resumeToText(r.data).slice(0, 8000),
        });
        perResume.push({ resume: r.id, ...out });
      } catch (e) {
        perResume.push({ resume: r.id, score: 0, verdict: 'weak', matched: [], gaps: [], reason: `error: ${e.message.slice(0, 120)}` });
      }
    }
    perResume.sort((a, b) => b.score - a.score);
    const best = perResume[0];
    meta[jobKey(job)] = {
      company: job.company,
      title: job.title,
      url: job.url,
      min_experience_required: job.min_experience_required ?? null,
      best_score: best.score,
      best_resume: best.resume,
      best_verdict: best.verdict,
      matched: best.matched,
      gaps: best.gaps,
      reason: best.reason,
      per_resume: perResume.map((p) => ({ resume: p.resume, score: p.score, verdict: p.verdict })),
      rated_at: new Date().toISOString(),
    };
    console.log(`• ${best.best_score ?? best.score}/5  ${job.company} — ${job.title}  [best: ${best.resume}]`);
  }

  mkdirSync(path.dirname(META_PATH), { recursive: true });
  writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf-8');
  console.log(`\n✅ wrote ratings → data/eval-meta.json (${Object.keys(meta).length} jobs total)`);
}

main().catch((e) => {
  console.error('\n❌ rate-jobs failed:', e.message);
  process.exit(1);
});
