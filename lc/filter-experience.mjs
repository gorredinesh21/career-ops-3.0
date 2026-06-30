#!/usr/bin/env node
/**
 * lc/filter-experience.mjs — Stage 2 of the career-ops-3.0 pipeline.
 *
 * Adds a `min_experience_required` field to every job (extracted from its
 * JD text) and DROPS any posting whose stated minimum exceeds
 * MAX_MIN_EXPERIENCE (default 3 years). Jobs with no stated requirement are
 * KEPT (unstated == open to junior/mid).
 *
 * Deterministic regex extraction (ported from triage-experience.mjs). Runs
 * with zero LLM cost. Reads a normalized job array and writes the filtered
 * array with the new column attached.
 *
 * Usage:
 *   node lc/filter-experience.mjs --in data/daily/2026-06-18.json --out tmp/filtered.json
 *   node lc/filter-experience.mjs --in <file>          # prints summary, writes <file>.filtered.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const MAX_MIN_EXPERIENCE = Number(process.env.MAX_MIN_EXPERIENCE ?? 3);

/**
 * Extract the minimum years-of-experience signal from JD text.
 * Returns a number, or null when nothing is stated.
 */
export function extractMinYears(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const mins = [];
  // ranges: "3-5 years", "3 to 5 years", "3 - 5 yrs"  -> lower bound
  for (const m of t.matchAll(/(\d{1,2})\s*(?:-|–|to)\s*\d{1,2}\s*\+?\s*(?:years?|yrs?)/g)) {
    mins.push(+m[1]);
  }
  // "5+ years"
  for (const m of t.matchAll(/(\d{1,2})\s*\+\s*(?:years?|yrs?)/g)) mins.push(+m[1]);
  // explicit floor: "minimum 7 years", "at least 5 yrs", "over 8 years", ">= 4 years"
  for (const m of t.matchAll(
    /(?:minimum|min\.?|at\s*least|over|>=?)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/g
  )) {
    mins.push(+m[1]);
  }
  // "5 years of experience", "5 yrs experience", "5 years relevant"
  for (const m of t.matchAll(
    /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp\b|relevant)/g
  )) {
    mins.push(+m[1]);
  }
  if (mins.length === 0) return null;
  return Math.min(...mins); // smallest stated floor == the "minimum required" signal
}

/**
 * Attach min_experience_required and split into kept / dropped.
 * @param {object[]} jobs  normalized jobs (need a description field)
 * @param {number} max     drop jobs with min_experience_required > max
 */
export function filterByExperience(jobs, max = MAX_MIN_EXPERIENCE) {
  const kept = [];
  const dropped = [];
  for (const job of jobs) {
    const jd = job.descriptionText || job.description || job.raw_source_text || '';
    const min = extractMinYears(jd);
    const enriched = { ...job, min_experience_required: min };
    if (min != null && min > max) dropped.push(enriched);
    else kept.push(enriched);
  }
  return { kept, dropped };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { in: null, out: null, max: MAX_MIN_EXPERIENCE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') args.in = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--max') args.max = Number(argv[++i]);
    else if (!argv[i].startsWith('--') && !args.in) args.in = argv[i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.in || !existsSync(args.in)) {
    console.error('Usage: node lc/filter-experience.mjs --in <jobs.json> [--out <file>] [--max 3]');
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(args.in, 'utf-8'));
  const jobs = Array.isArray(raw) ? raw : raw.jobs || [];
  const { kept, dropped } = filterByExperience(jobs, args.max);

  const outPath = args.out || args.in.replace(/\.json$/, '.filtered.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(kept, null, 2), 'utf-8');

  console.log(`Experience filter (max ${args.max} yrs)`);
  console.log(`  input:   ${jobs.length} jobs`);
  console.log(`  kept:    ${kept.length}`);
  console.log(`  dropped: ${dropped.length} (stated minimum > ${args.max} yrs)`);
  for (const d of dropped) {
    console.log(`     ✗ ${d.min_experience_required}yr  ${d.company || '?'} — ${d.title || '?'}`);
  }
  console.log(`\n  → wrote ${outPath}`);
}

// run only when invoked directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('filter-experience.mjs')) {
  main();
}
