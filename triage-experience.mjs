#!/usr/bin/env node
// triage-experience.mjs — quick ≤3-yr experience gate over a daily job table.
// Reads data/daily/<date>.json, extracts the MINIMUM years-of-experience signal
// from each JD's descriptionText, and flags PASS (min <= 3 or unstated) vs SKIP
// (min > 3). Cheap pre-filter before full A–F evaluation. Output is compact.
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const file = path.join(HERE, 'data', 'daily', `${date}.json`);
if (!existsSync(file)) { console.error(`no daily file for ${date}`); process.exit(1); }
const jobs = JSON.parse(readFileSync(file, 'utf-8'));

// Extract minimum years of experience required, if any.
function minYears(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  const mins = [];
  // ranges: "3-5 years", "3 to 5 years", "3 - 5 yrs"
  for (const m of t.matchAll(/(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)/g)) mins.push(+m[1]);
  // "5+ years", "minimum 5 years", "at least 5 years", "5 years of experience"
  for (const m of t.matchAll(/(?:minimum|min\.?|at least|over)?\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp|relevant)/g)) mins.push(+m[1]);
  if (mins.length === 0) return null;
  // Use the smallest stated number as the "minimum required" signal.
  return Math.min(...mins);
}

// Dedup by company::title (pipeline-equivalent), keep first.
const seen = new Set();
const rows = [];
for (const j of jobs) {
  const key = `${(j.company || '').toLowerCase()}::${(j.title || '').toLowerCase()}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const my = minYears(j.descriptionText);
  const verdict = my == null ? 'PASS?' : (my <= 3 ? 'PASS' : 'SKIP');
  rows.push({ verdict, my, title: j.title, company: j.company, location: j.location, sen: j.seniorityLevel });
}

const pass = rows.filter(r => r.verdict !== 'SKIP');
const skip = rows.filter(r => r.verdict === 'SKIP');
const fmt = (r) => `  ${r.verdict.padEnd(5)} min=${r.my == null ? '—' : r.my} | ${r.company} — ${r.title} (${r.location})`;
console.log(`Triage ${date} — ${rows.length} unique roles  |  PASS/unstated: ${pass.length}, SKIP(>3yr): ${skip.length}\n`);
console.log('— SKIP (stated minimum > 3 years) —');
for (const r of skip) console.log(fmt(r));
console.log('\n— PASS / unstated (proceed to full evaluation) —');
for (const r of pass) console.log(fmt(r));
