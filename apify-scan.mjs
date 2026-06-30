#!/usr/bin/env node

/**
 * apify-scan.mjs — Apify-powered job discovery for career-ops.
 *
 * A THIRD discovery source alongside the zero-token portal scanner (scan.mjs,
 * company career sites) and the Telegram feed. Runs the Apify job-scraper
 * Actors configured under `apify:` in portals.yml, normalizes their output,
 * de-duplicates against everything already seen (scan-history.tsv, pipeline.md,
 * applications.md), applies the SAME title + location filters as scan.mjs, and
 * appends survivors to data/pipeline.md so the rest of the pipeline
 * (/career-ops pipeline → score → tailored resume) picks them up unchanged.
 *
 * Pipeline position:
 *   [Telegram] + [company sites: scan.mjs] + [Apify: this file]
 *        → dedupe → filter → (agent) score → (agent) tailored resume
 *
 * Secrets: reads APIFY_TOKEN from .env (same pattern as linkedin/lib.mjs).
 * Network: run with the corporate-CA fix so HTTPS to Apify works:
 *
 *   $env:NODE_OPTIONS="--use-system-ca"; node apify-scan.mjs            # live
 *   $env:NODE_OPTIONS="--use-system-ca"; node apify-scan.mjs --dry-run  # preview, no writes
 *   $env:NODE_OPTIONS="--use-system-ca"; node apify-scan.mjs --platform linkedin   # one actor
 *
 * Pay-per-result — see the pricing note in portals.yml. Keep limits modest.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import yaml from 'js-yaml';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORTALS_PATH = process.env.CAREER_OPS_PORTALS || path.join(HERE, 'portals.yml');
const ENV_PATH = path.join(HERE, '.env');
const DATA_DIR = path.join(HERE, 'data');
const PIPELINE_PATH = path.join(DATA_DIR, 'pipeline.md');
const SCAN_HISTORY_PATH = path.join(DATA_DIR, 'scan-history.tsv');
const APPLICATIONS_PATH = path.join(DATA_DIR, 'applications.md');
const APIFY = 'https://api.apify.com/v2';

// ── .env loader (tiny, zero-dep) ────────────────────────────────────
function loadEnv() {
  if (!existsSync(ENV_PATH)) return;
  for (const line of readFileSync(ENV_PATH, 'utf-8').split('\n')) {
    const s = line.trim();
    if (!s || s.startsWith('#') || !s.includes('=')) continue;
    const [k, ...v] = s.split('=');
    const key = k.trim();
    if (!(key in process.env)) process.env[key] = v.join('=').trim();
  }
}

// ── Filters (mirror scan.mjs semantics) ─────────────────────────────
function normalizeKeywordList(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.filter(k => typeof k === 'string').map(k => k.toLowerCase().trim()).filter(Boolean);
}

function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(k => k.toLowerCase());
  const negative = (titleFilter?.negative || []).map(k => k.toLowerCase());
  return (title) => {
    const lower = (title || '').toLowerCase();
    const hasPositive = positive.length === 0 || positive.some(k => lower.includes(k));
    const hasNegative = negative.some(k => lower.includes(k));
    return hasPositive && !hasNegative;
  };
}

function buildLocationFilter(locationFilter) {
  if (!locationFilter) return () => true;
  const alwaysAllow = normalizeKeywordList(locationFilter.always_allow);
  const allow = normalizeKeywordList(locationFilter.allow);
  const block = normalizeKeywordList(locationFilter.block);
  return (location) => {
    if (typeof location !== 'string' || location.trim() === '') return true;
    const lower = location.toLowerCase();
    if (alwaysAllow.length > 0 && alwaysAllow.some(k => lower.includes(k))) return true;
    if (block.length > 0 && block.some(k => lower.includes(k))) return false;
    if (allow.length === 0) return true;
    return allow.some(k => lower.includes(k));
  };
}

// Stable dedup key for a URL — strips query string + hash + trailing slash, so
// the same LinkedIn job (whose `link` carries volatile tracking params like
// trackingId/refId on every scrape) maps to ONE key across runs.
function cleanUrl(u) {
  if (!u) return u;
  try {
    const x = new URL(u);
    return x.origin + x.pathname.replace(/\/+$/, '');
  } catch {
    return String(u).split('?')[0].split('#')[0].replace(/\/+$/, '');
  }
}

// ── Dedup sets (mirror scan.mjs) ────────────────────────────────────
// Store BOTH the raw and cleaned form of every seen URL so a freshly-cleaned
// apify URL still matches a previously-stored raw (param-laden) one.
function loadSeenUrls() {
  const seen = new Set();
  const add = (u) => { if (u) { seen.add(u); seen.add(cleanUrl(u)); } };
  if (existsSync(SCAN_HISTORY_PATH)) {
    for (const line of readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n').slice(1)) {
      add(line.split('\t')[0]);
    }
  }
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    for (const m of text.matchAll(/- \[[ x]\] (https?:\/\/\S+)/g)) add(m[1]);
  }
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const m of text.matchAll(/https?:\/\/[^\s|)]+/g)) add(m[0]);
  }
  return seen;
}

function loadSeenCompanyRoles() {
  const seen = new Set();
  const add = (company, role) => {
    const c = (company || '').trim().toLowerCase();
    const r = (role || '').trim().toLowerCase();
    if (c && r && c !== 'company') seen.add(`${c}::${r}`);
  };
  if (existsSync(APPLICATIONS_PATH)) {
    const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
    for (const m of text.matchAll(/\|[^|]+\|[^|]+\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g)) add(m[1], m[2]);
  }
  // Also dedup against jobs already queued for evaluation (pipeline.md), which
  // applications.md won't contain until they're scored.
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    // line format: - [ ] {url} | {company} | {title}
    for (const m of text.matchAll(/- \[[ x]\]\s*\S+\s*\|\s*([^|]+?)\s*\|\s*(.+)/g)) add(m[1], m[2]);
  }
  return seen;
}

// One-time cleanup: drop today's Apify rows so a re-scan repopulates cleanly
// (used after the URL-dedup fix, or any time you want to rebuild a day).
function resetToday(date) {
  if (existsSync(SCAN_HISTORY_PATH)) {
    const lines = readFileSync(SCAN_HISTORY_PATH, 'utf-8').split('\n');
    const header = lines[0];
    const APIFY_PORTALS = new Set(['linkedin', 'naukri', 'alljobs', 'wellfound']);
    const kept = lines.slice(1).filter(l => {
      if (!l.trim()) return false;
      const [, first_seen, portal] = l.split('\t');
      const p = portal || '';
      return !(first_seen === date && (p.startsWith('apify') || APIFY_PORTALS.has(p)));
    });
    writeFileSync(SCAN_HISTORY_PATH, [header, ...kept].join('\n') + '\n', 'utf-8');
  }
  if (existsSync(PIPELINE_PATH)) {
    const text = readFileSync(PIPELINE_PATH, 'utf-8');
    const kept = text.split('\n').filter(l =>
      !/^- \[[ x]\] https?:\/\/(www\.)?linkedin\.com\/jobs\//.test(l));
    writeFileSync(PIPELINE_PATH, kept.join('\n'), 'utf-8');
  }
  const f = path.join(DAILY_DIR, `${date}.json`);
  if (existsSync(f)) writeFileSync(f, '[]', 'utf-8');
}

// ── Writers (mirror scan.mjs format) ────────────────────────────────
function ensurePipelineFile() {
  if (!existsSync(PIPELINE_PATH)) {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(PIPELINE_PATH, '# Pipeline — pending job URLs\n\n## Pendientes\n\n## Procesadas\n', 'utf-8');
  }
}

function appendToPipeline(offers) {
  if (offers.length === 0) return;
  ensurePipelineFile();
  let text = readFileSync(PIPELINE_PATH, 'utf-8');
  const marker = '## Pendientes';
  const idx = text.indexOf(marker);
  const row = o => `- [ ] ${o.url} | ${o.company} | ${o.title}`;
  if (idx === -1) {
    const procIdx = text.indexOf('## Procesadas');
    const insertAt = procIdx === -1 ? text.length : procIdx;
    const block = `\n${marker}\n\n` + offers.map(row).join('\n') + '\n\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  } else {
    const afterMarker = idx + marker.length;
    const nextSection = text.indexOf('\n## ', afterMarker);
    const insertAt = nextSection === -1 ? text.length : nextSection;
    const block = '\n' + offers.map(row).join('\n') + '\n';
    text = text.slice(0, insertAt) + block + text.slice(insertAt);
  }
  writeFileSync(PIPELINE_PATH, text, 'utf-8');
}

function appendToScanHistory(offers, date) {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(SCAN_HISTORY_PATH)) {
    writeFileSync(SCAN_HISTORY_PATH, 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n', 'utf-8');
  }
  const lines = offers.map(o =>
    `${o.url}\t${date}\tapify-${o.source}\t${o.title}\t${o.company}\tadded\t${o.location || ''}`
  ).join('\n') + '\n';
  appendFileSync(SCAN_HISTORY_PATH, lines, 'utf-8');
}

// Per-day job table → data/daily/<date>.json. Upserts by url (re-running a scan
// refreshes the same day's rows). This is the rich table the web dashboard reads.
const DAILY_DIR = path.join(DATA_DIR, 'daily');
function upsertDaily(date, records) {
  if (records.length === 0) return;
  mkdirSync(DAILY_DIR, { recursive: true });
  const file = path.join(DAILY_DIR, `${date}.json`);
  let existing = [];
  if (existsSync(file)) { try { existing = JSON.parse(readFileSync(file, 'utf-8')); } catch { existing = []; } }
  const byUrl = new Map(existing.map(r => [r.url, r]));
  for (const r of records) {
    byUrl.set(r.url, byUrl.has(r.url) ? { ...byUrl.get(r.url), ...r } : r);
  }
  writeFileSync(file, JSON.stringify([...byUrl.values()], null, 2), 'utf-8');
}

// ── Apify run helper ────────────────────────────────────────────────
async function runActor(actorId, input, token, timeoutSecs = 300) {
  const url = `${APIFY}/acts/${actorId}/run-sync-get-dataset-items?token=${token}&timeout=${timeoutSecs}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`${actorId} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

// ── Input builders (per actor schema) ───────────────────────────────
function linkedinInput(cfg) {
  const kw = '(' + cfg.keywords.map(k => `"${k}"`).join(' OR ') + ')';
  const days = Number(cfg.date_posted_days) || 0;
  const tpr = days > 0 ? `&f_TPR=r${days * 86400}` : '';
  const fE = (cfg.experience_levels || []).join(',');
  const fe = fE ? `&f_E=${encodeURIComponent(fE)}` : '';
  const geo = cfg.geo_id ? `&geoId=${cfg.geo_id}` : '';
  const loc = encodeURIComponent(cfg.location || 'India');
  const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(kw)}&location=${loc}${geo}${tpr}${fe}`;
  return { urls: [url], count: Number(cfg.max_results_linkedin) || 40, scrapeCompany: false };
}

function naukriInput(cfg, keyword) {
  const allowed = ['1', '3', '7', '15', '30'];
  const days = String(cfg.date_posted_days || '');
  return {
    keyword,
    maxJobs: Number(cfg.max_results_per_keyword) || 12,
    freshness: allowed.includes(days) ? days : 'all',
    experience: String(cfg.naukri_experience ?? 'all'),
    sortBy: 'date',
    fetchDetails: false,
  };
}

function alljobsInput(cfg, keyword) {
  return {
    keyword,
    country: cfg.location || 'India',
    max_results: Number(cfg.max_results_per_keyword) || 12,
    job_type: 'all',
    remote_only: false,
  };
}

// ── Output mapping (defensive field mapping) ────────────────────────
function pick(item, ...keys) {
  for (const k of keys) {
    const v = item[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

// Minimal mapping (title/company/location/url) for non-LinkedIn actors.
function mapMinimal(platform, item) {
  if (platform === 'naukri') {
    return {
      title: pick(item, 'title', 'jobTitle', 'designation', 'name'),
      company: pick(item, 'companyName', 'company', 'companyNameText'),
      location: pick(item, 'location', 'jobLocation', 'placeholders', 'city'),
      url: pick(item, 'jobUrl', 'url', 'jdURL', 'link', 'jobUrlText'),
    };
  }
  // alljobs (and any future generic actor)
  return {
    title: pick(item, 'title', 'job_title', 'jobTitle', 'position'),
    company: pick(item, 'company', 'company_name', 'companyName', 'employer'),
    location: pick(item, 'location', 'job_location', 'city', 'place'),
    url: pick(item, 'url', 'job_url', 'jobUrl', 'link', 'apply_url', 'applyUrl'),
  };
}

// Canonical "daily table" record. Columns mirror what the LinkedIn Actor returns
// (id, link, title, companyName, location, postedAt, applicantsCount, applyUrl,
// salary, descriptionText, seniorityLevel, employmentType, jobFunction,
// industries, companyLogo, companyLinkedinUrl). Other sources fill what they can;
// missing columns stay as ''. See modes/_profile.md.
function buildRecord(platform, item, date) {
  const base = {
    source: platform, title: '', company: '', location: '', url: '',
    applyUrl: '', postedAt: '', salary: '', seniorityLevel: '', employmentType: '',
    jobFunction: '', industries: '', applicantsCount: '', companyLogo: '',
    companyLinkedinUrl: '', descriptionText: '', scannedDate: date,
  };
  if (platform === 'linkedin') {
    const industries = Array.isArray(item.industries) ? item.industries.join(', ') : pick(item, 'industries');
    const jobFunction = Array.isArray(item.jobFunction) ? item.jobFunction.join(', ') : pick(item, 'jobFunction');
    return {
      ...base,
      title: pick(item, 'title', 'jobTitle'),
      company: pick(item, 'companyName', 'company'),
      location: pick(item, 'location', 'jobLocation'),
      url: pick(item, 'link', 'jobUrl', 'url', 'applyUrl'),
      applyUrl: pick(item, 'applyUrl'),
      postedAt: pick(item, 'postedAt', 'listedAt'),
      salary: pick(item, 'salary'),
      seniorityLevel: pick(item, 'seniorityLevel'),
      employmentType: pick(item, 'employmentType'),
      jobFunction,
      industries,
      applicantsCount: item.applicantsCount != null ? String(item.applicantsCount) : '',
      companyLogo: pick(item, 'companyLogo'),
      companyLinkedinUrl: pick(item, 'companyLinkedinUrl'),
      descriptionText: pick(item, 'descriptionText'),
    };
  }
  return { ...base, ...mapMinimal(platform, item) };
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const reset = args.includes('--reset-today');
  const platFlag = args.indexOf('--platform');
  const onlyPlatform = platFlag !== -1 ? args[platFlag + 1]?.toLowerCase() : null;

  loadEnv();
  const token = process.env.APIFY_TOKEN;
  if (!token) { console.error('Error: APIFY_TOKEN not found in .env'); process.exit(1); }

  if (!existsSync(PORTALS_PATH)) { console.error('Error: portals.yml not found.'); process.exit(1); }
  const config = yaml.load(readFileSync(PORTALS_PATH, 'utf-8'));
  const cfg = config.apify;
  if (!cfg || cfg.enabled === false) { console.error('apify: section missing or disabled in portals.yml'); process.exit(0); }

  const titleFilter = buildTitleFilter(config.title_filter);
  const locationFilter = buildLocationFilter(config.location_filter);
  const keywords = (cfg.keywords || []).filter(Boolean);
  if (keywords.length === 0) { console.error('No apify.keywords configured.'); process.exit(1); }

  const date = new Date().toISOString().slice(0, 10);
  if (reset && !dryRun) { resetToday(date); console.log(`(reset-today: cleared today's Apify rows before scanning)\n`); }

  const seenUrls = loadSeenUrls();
  const seenCompanyRoles = loadSeenCompanyRoles();

  const actors = (cfg.actors || []).filter(a => a && a.enabled !== false &&
    (!onlyPlatform || a.platform === onlyPlatform));
  if (actors.length === 0) { console.error('No enabled actors match.'); process.exit(0); }

  let totalFound = 0, fTitle = 0, fLoc = 0, dupes = 0, malformed = 0;
  const newOffers = [];       // not seen before → appended to pipeline.md for scoring
  const dailyRecords = [];    // ALL of today's filtered jobs → daily table (within-run url dedup)
  const dailySeen = new Set();
  const errors = [];

  // Build the per-actor run plan
  const runs = [];
  for (const a of actors) {
    if (a.platform === 'linkedin') {
      runs.push({ platform: 'linkedin', actorId: a.id, label: 'linkedin (OR search)', input: linkedinInput(cfg) });
    } else if (a.platform === 'naukri') {
      for (const kw of keywords) runs.push({ platform: 'naukri', actorId: a.id, label: `naukri "${kw}"`, input: naukriInput(cfg, kw) });
    } else if (a.platform === 'alljobs') {
      for (const kw of keywords) runs.push({ platform: 'alljobs', actorId: a.id, label: `all-jobs "${kw}"`, input: alljobsInput(cfg, kw) });
    } else {
      // unknown platform: try generic per-keyword run, normalized generically
      for (const kw of keywords) runs.push({ platform: a.platform, actorId: a.id, label: `${a.platform} "${kw}"`, input: { keyword: kw, max_results: Number(cfg.max_results_per_keyword) || 12 } });
    }
  }

  console.log(`Apify scan — ${date}  (${runs.length} run${runs.length === 1 ? '' : 's'}${dryRun ? ', DRY RUN' : ''})\n`);

  for (const run of runs) {
    process.stdout.write(`  → ${run.label} ... `);
    try {
      const items = await runActor(run.actorId, run.input, token);
      totalFound += items.length;
      let added = 0;
      for (const raw of items) {
        const rec = buildRecord(run.platform, raw, date);
        rec.url = cleanUrl(rec.url);
        if (!rec.url || !rec.title) { malformed++; continue; }
        if (!titleFilter(rec.title)) { fTitle++; continue; }
        if (!locationFilter(rec.location)) { fLoc++; continue; }

        // Daily table: every filtered job from today's scrape (dedup within run).
        if (!dailySeen.has(rec.url)) { dailySeen.add(rec.url); dailyRecords.push(rec); }

        // Pipeline: only jobs not already seen across sources/days get scored.
        if (seenUrls.has(rec.url)) { dupes++; continue; }
        const key = `${(rec.company || '').toLowerCase()}::${rec.title.toLowerCase()}`;
        if (rec.company && seenCompanyRoles.has(key)) { dupes++; continue; }
        seenUrls.add(rec.url);
        if (rec.company) seenCompanyRoles.add(key);
        newOffers.push(rec);
        added++;
      }
      console.log(`${items.length} found, ${added} new`);
    } catch (err) {
      console.log('FAILED');
      errors.push({ run: run.label, error: err.message });
    }
  }

  if (!dryRun) {
    if (newOffers.length > 0) {
      appendToPipeline(newOffers);
      appendToScanHistory(newOffers, date);
    }
    upsertDaily(date, dailyRecords);
  }

  console.log(`\n${'━'.repeat(48)}`);
  console.log(`Apify Scan Summary — ${date}`);
  console.log(`${'━'.repeat(48)}`);
  console.log(`Runs executed:         ${runs.length}`);
  console.log(`Total jobs found:      ${totalFound}`);
  console.log(`Filtered by title:     ${fTitle}`);
  console.log(`Filtered by location:  ${fLoc}`);
  console.log(`Malformed (no url):    ${malformed}`);
  console.log(`Duplicates (pipeline): ${dupes}`);
  console.log(`Daily table rows:      ${dailyRecords.length}  (data/daily/${date}.json)`);
  console.log(`New offers (pipeline): ${newOffers.length}`);

  if (errors.length > 0) {
    console.log(`\nErrors (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ ${e.run}: ${e.error}`);
  }
  if (dailyRecords.length > 0) {
    console.log("\nToday's jobs:");
    for (const o of dailyRecords) {
      const isNew = newOffers.includes(o);
      console.log(`  ${isNew ? '+' : '·'} [${o.source}] ${o.company} | ${o.title} | ${o.location || 'N/A'}`);
    }
    console.log(dryRun
      ? '\n(dry run — nothing written)'
      : `\nDaily table → data/daily/${date}.json   |   new pipeline rows → pipeline.md`);
    console.log('  (+ = new to pipeline, · = already seen, still in today\'s table)');
  }
  console.log(`\n→ Run /career-ops pipeline to score new offers and generate tailored resumes (output/${date}/).`);
  console.log(`→ Web dashboard: node dashboard-web/server.mjs → http://localhost:4317`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
}
