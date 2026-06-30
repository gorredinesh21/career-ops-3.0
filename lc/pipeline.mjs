#!/usr/bin/env node
/**
 * lc/pipeline.mjs — orchestrate the career-ops-3.0 LangChain pipeline end to end.
 *
 *   [optional] fetch-jd  →  filter-experience  →  rate-jobs  →  gen-resume
 *
 * Input is a normalized jobs file (e.g. data/daily/<date>.json from the Apify
 * scan, or output/scan-jobs-<date>.json from the ATS scan). For ATS scans that
 * lack JD text, pass --fetch-jd to pull descriptions first.
 *
 * Usage:
 *   node lc/pipeline.mjs --in data/daily/2026-06-18.json
 *   node lc/pipeline.mjs --in output/scan-jobs-2026-06-10.json --fetch-jd --min-score 4 --render
 */

import { spawnSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const TMP = path.join(ROOT, 'tmp');

function run(label, scriptRelPath, args) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, [path.join(ROOT, scriptRelPath), ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --use-system-ca`.trim() },
  });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

function main() {
  const args = process.argv.slice(2);
  let inPath = null, fetchJd = false, minScore = '3.5', render = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in') inPath = args[++i];
    else if (args[i] === '--fetch-jd') fetchJd = true;
    else if (args[i] === '--min-score') minScore = args[++i];
    else if (args[i] === '--render') render = true;
    else if (!args[i].startsWith('--') && !inPath) inPath = args[i];
  }
  if (!inPath || !existsSync(inPath)) {
    console.error('Usage: node lc/pipeline.mjs --in <jobs.json> [--fetch-jd] [--min-score 3.5] [--render]');
    process.exit(1);
  }
  mkdirSync(TMP, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  let current = inPath;

  if (fetchJd) {
    const withJd = path.join(TMP, `pipe-${stamp}.with-jd.json`);
    run('Stage 1 — fetch JD (ATS)', 'lc/fetch-jd.mjs', ['--in', current, '--out', withJd]);
    current = withJd;
  }

  const filtered = path.join(TMP, `pipe-${stamp}.filtered.json`);
  run('Stage 2 — experience filter (drop >3yr)', 'lc/filter-experience.mjs', ['--in', current, '--out', filtered]);

  run('Stage 3 — rate jobs (×resumes, /5)', 'lc/rate-jobs.mjs', ['--in', filtered]);

  run('Stage 4 — generate tailored resumes', 'lc/gen-resume.mjs',
    ['--in', filtered, '--min-score', minScore, ...(render ? ['--render'] : [])]);

  console.log('\n✅ pipeline complete. Ratings → data/eval-meta.json, resumes → resume-engine/jobs/');
}

main();
