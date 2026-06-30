#!/usr/bin/env node
/**
 * lc/fetch-jd.mjs — Stage 1: fetch the job description for ATS-scan jobs.
 *
 * The ATS scanner (scan.mjs + providers/*) returns list-page fields only
 * (title/url/company/location) — no JD text. This walks such jobs, opens each
 * URL with Playwright (reusing the liveness browser helpers + SSRF guard), and
 * attaches the page's visible text as `descriptionText` so the downstream
 * LangChain stages (experience filter, rating, resume gen) have a JD to read.
 *
 * Jobs that already have descriptionText (e.g. the LinkedIn/Apify path) are
 * left untouched.
 *
 * Usage:
 *   node lc/fetch-jd.mjs --in output/scan-jobs-2026-06-10.json --out tmp/with-jd.json
 *   node lc/fetch-jd.mjs --in <file> --limit 20
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { chromium } from 'playwright';
import { newLivenessPage, rejectPrivateOrInvalid, sleep, jitteredDelayMs } from '../liveness-browser.mjs';

const NAV_TIMEOUT_MS = 20_000;
const HYDRATION_MS = 2_000;
const THROTTLE_MS = 800;

async function fetchOne(page, url) {
  const guard = rejectPrivateOrInvalid(url);
  if (guard) return { ok: false, reason: guard.reason };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await page.waitForTimeout(HYDRATION_MS); // let SPAs (Ashby/Lever/Workday) hydrate
    const text = await page.evaluate(() => document.body?.innerText ?? '');
    return { ok: true, text: text.replace(/\n{3,}/g, '\n\n').trim() };
  } catch (err) {
    return { ok: false, reason: err.message.split('\n')[0] };
  }
}

async function main() {
  const args = process.argv.slice(2);
  let inPath = null, outPath = null, limit = Infinity, force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--in') inPath = args[++i];
    else if (args[i] === '--out') outPath = args[++i];
    else if (args[i] === '--limit') limit = Number(args[++i]);
    else if (args[i] === '--force') force = true; // re-fetch even if descriptionText exists
    else if (!args[i].startsWith('--') && !inPath) inPath = args[i];
  }
  if (!inPath || !existsSync(inPath)) {
    console.error('Usage: node lc/fetch-jd.mjs --in <jobs.json> [--out <file>] [--limit N] [--force]');
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(inPath, 'utf-8'));
  const jobs = Array.isArray(raw) ? raw : raw.jobs || [];
  const targets = jobs.filter((j) => j.url && (force || !(j.descriptionText || j.description)));
  console.log(`${jobs.length} jobs; ${targets.length} need a JD fetch (limit ${limit}).\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await newLivenessPage(browser);

  let done = 0, ok = 0;
  for (const job of targets) {
    if (done >= limit) break;
    done++;
    process.stdout.write(`• ${job.company || '?'} — ${job.title || '?'} ... `);
    const res = await fetchOne(page, job.url);
    if (res.ok && res.text && res.text.length > 200) {
      job.descriptionText = res.text;
      ok++;
      console.log(`ok (${res.text.length} chars)`);
    } else {
      console.log(`no JD (${res.reason || 'thin/empty page'})`);
    }
    const d = jitteredDelayMs(THROTTLE_MS);
    if (d) await sleep(d);
  }

  await browser.close();

  const finalOut = outPath || inPath.replace(/\.json$/, '.with-jd.json');
  mkdirSync(dirname(finalOut), { recursive: true });
  writeFileSync(finalOut, JSON.stringify(jobs, null, 2), 'utf-8');
  console.log(`\n✅ fetched ${ok}/${done} JDs → ${finalOut}`);
}

main().catch((e) => {
  console.error('\n❌ fetch-jd failed:', e.message);
  process.exit(1);
});
