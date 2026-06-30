// parsers.mjs — turn career-ops data files into structured JSON.
// The data files ARE the database; these readers never mutate them
// (except applications.md via the dedicated updateApplicationStatus()).

import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// ── Canonical states (shared contract with the writer) ───────────────
export function loadStates(repoRoot) {
  const p = path.join(repoRoot, 'templates', 'states.yml');
  if (!existsSync(p)) return { states: [] };
  const doc = yaml.load(readFileSync(p, 'utf-8')) || {};
  return { states: doc.states || [] };
}

// Map any status string (label or alias, case-insensitive) → canonical state.
export function buildStatusResolver(states) {
  const map = new Map();
  for (const s of states) {
    map.set(s.label.toLowerCase(), s);
    map.set(s.id.toLowerCase(), s);
    for (const a of s.aliases || []) map.set(String(a).toLowerCase(), s);
  }
  return (raw) => {
    if (!raw) return null;
    const key = String(raw).replace(/\*/g, '').trim().toLowerCase();
    return map.get(key) || null;
  };
}

// ── applications.md ──────────────────────────────────────────────────
// Columns: | # | Date | Company | Role | Score | Status | PDF | Report | Notes |
function splitRow(line) {
  // Drop the leading/trailing pipe, split, trim.
  const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  return cells;
}

function isSeparator(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');
}

function extractLink(cell) {
  // [text](url) → {text, url}; else {text: cell, url: null}
  const m = cell.match(/\[([^\]]*)\]\(([^)]+)\)/);
  if (m) return { text: m[1], url: m[2] };
  return { text: cell, url: null };
}

export function parseApplications(repoRoot) {
  const p = path.join(repoRoot, 'data', 'applications.md');
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, 'utf-8').split('\n');
  const rows = [];
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue;
    if (isSeparator(line)) continue;
    const c = splitRow(line);
    if (c.length < 6) continue;
    if (c[0].toLowerCase() === '#' || c[0].toLowerCase() === 'num') continue; // header
    const [num, date, company, role, score, status, pdf, report, ...rest] = c;
    const notes = rest.join(' | ');
    const scoreNum = (() => {
      const m = String(score).match(/([\d.]+)/);
      return m ? parseFloat(m[1]) : null;
    })();
    const rep = extractLink(report || '');
    // report cell is usually a plain path like "reports/007-foo.md"; capture the
    // basename so the server can join this row to its parsed report (apply URL + PDF).
    const reportRef = rep.url || rep.text || '';
    const reportFile = reportRef && reportRef !== '-' ? reportRef.split('/').pop() : null;
    rows.push({
      num: num || '',
      date: date || '',
      company: company || '',
      role: role || '',
      score: scoreNum,
      scoreRaw: score || '',
      status: status || '',
      pdf: /✅|yes|true/i.test(pdf || ''),
      report: rep.url,
      reportText: rep.text,
      reportFile,
      notes: notes || '',
    });
  }
  return rows;
}

// ── pipeline.md ──────────────────────────────────────────────────────
// Lines like:  - [ ] {url} | {company} | {title}   (also "## Procesadas")
function parsePipelineSection(text, header) {
  const out = [];
  const idx = text.indexOf(header);
  if (idx === -1) return out;
  const after = text.slice(idx + header.length);
  const next = after.search(/\n##\s/);
  const block = next === -1 ? after : after.slice(0, next);
  for (const m of block.matchAll(/- \[([ x])\]\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*(.+)/g)) {
    out.push({
      done: m[1] === 'x',
      url: m[2].trim(),
      company: m[3].trim(),
      title: m[4].trim(),
    });
  }
  return out;
}

export function parsePipeline(repoRoot) {
  const p = path.join(repoRoot, 'data', 'pipeline.md');
  if (!existsSync(p)) return { pending: [], processed: [] };
  const text = readFileSync(p, 'utf-8');
  return {
    pending: parsePipelineSection(text, '## Pendientes'),
    processed: parsePipelineSection(text, '## Procesadas'),
  };
}

// ── scan-history.tsv ─────────────────────────────────────────────────
export function parseScanHistory(repoRoot) {
  const p = path.join(repoRoot, 'data', 'scan-history.tsv');
  if (!existsSync(p)) return [];
  const lines = readFileSync(p, 'utf-8').split('\n').filter(Boolean);
  if (lines.length <= 1) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const [url, first_seen, portal, title, company, status, location] = line.split('\t');
    if (!url) continue;
    out.push({ url, first_seen: first_seen || '', portal: portal || '', title: title || '', company: company || '', status: status || '', location: location || '' });
  }
  return out;
}

// ── data/daily/<date>.json  +  scan-history (the daily job table) ─────
// The rich per-day table written by apify-scan.mjs, merged with that day's
// scan-history rows (company sites + Telegram) which fill only the columns
// they have. Keyed by url; the rich JSON row wins over a scan-history stub.
const DAILY_COLUMNS = [
  'source', 'title', 'company', 'location', 'url', 'applyUrl', 'postedAt',
  'salary', 'seniorityLevel', 'employmentType', 'jobFunction', 'industries',
  'applicantsCount', 'companyLogo', 'companyLinkedinUrl', 'scannedDate',
];

function blankDaily() {
  return Object.fromEntries(DAILY_COLUMNS.map(k => [k, '']));
}

export function listDailyDates(repoRoot) {
  const dir = path.join(repoRoot, 'data', 'daily');
  const dates = new Set();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
      if (m) dates.add(m[1]);
    }
  }
  // Also surface dates that only exist in scan-history (company sites / Telegram).
  for (const r of parseScanHistory(repoRoot)) if (r.first_seen) dates.add(r.first_seen);
  return [...dates].sort().reverse();
}

export function parseDaily(repoRoot, date) {
  const byUrl = new Map();

  // 1. Rich Apify rows for the day (full columns). descriptionText/Html dropped
  //    from the payload — too heavy for a table; the JSON file still keeps them.
  const file = path.join(repoRoot, 'data', 'daily', `${date}.json`);
  if (existsSync(file)) {
    let rows = [];
    try { rows = JSON.parse(readFileSync(file, 'utf-8')); } catch { rows = []; }
    for (const r of rows) {
      if (!r || !r.url) continue;
      const rec = { ...blankDaily(), ...r };
      delete rec.descriptionText; delete rec.descriptionHtml;
      byUrl.set(r.url, rec);
    }
  }

  // 2. scan-history rows for the day (company sites + Telegram + any source).
  //    Only fill the columns these sources have; never overwrite a rich row.
  for (const r of parseScanHistory(repoRoot)) {
    if (r.first_seen !== date || !r.url || byUrl.has(r.url)) continue;
    byUrl.set(r.url, {
      ...blankDaily(),
      source: r.portal || 'scan',
      title: r.title, company: r.company, location: r.location,
      url: r.url, postedAt: r.first_seen, scannedDate: date,
    });
  }

  return [...byUrl.values()];
}

// ── reports/*.md ─────────────────────────────────────────────────────
function headerField(text, label) {
  const m = text.match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
}

export function parseReports(repoRoot) {
  const dir = path.join(repoRoot, 'reports');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.md')).sort()) {
    const text = readFileSync(path.join(dir, f), 'utf-8');
    const titleM = text.match(/^#\s+(.+)$/m);
    const scoreRaw = headerField(text, 'Score');
    const scoreM = scoreRaw && scoreRaw.match(/([\d.]+)/);
    // PDF header may be a real path ("output/cv-...-2026-06-10.pdf") or prose
    // ("not generated — below threshold"). Only keep it when it's a real file.
    const pdfRaw = headerField(text, 'PDF');
    const pdfM = pdfRaw && pdfRaw.match(/output\/(\S+\.pdf)/i);
    const pdfFile = pdfM ? pdfM[1] : null;
    // Optional "## Machine Summary" fenced YAML
    let machine = null;
    const ms = text.match(/##\s+Machine Summary\s*\n+```(?:ya?ml)?\n([\s\S]*?)\n```/i);
    if (ms) { try { machine = yaml.load(ms[1]); } catch { machine = null; } }
    out.push({
      file: f,
      title: titleM ? titleM[1].trim() : f,
      date: headerField(text, 'Date'),
      archetype: headerField(text, 'Archetype'),
      score: scoreM ? parseFloat(scoreM[1]) : null,
      url: headerField(text, 'URL'),
      pdfFile,
      legitimacy: headerField(text, 'Legitimacy'),
      machine,
    });
  }
  return out;
}

// ── profile.yml (header info only) ───────────────────────────────────
export function parseProfile(repoRoot) {
  const p = path.join(repoRoot, 'config', 'profile.yml');
  if (!existsSync(p)) return {};
  try {
    const doc = yaml.load(readFileSync(p, 'utf-8')) || {};
    const c = doc.candidate || {};
    return {
      name: c.full_name || '',
      location: c.location || '',
      targets: (doc.target_roles && doc.target_roles.primary) || [],
      headline: (doc.narrative && doc.narrative.headline) || '',
      comp: doc.compensation || {},
    };
  } catch { return {}; }
}

// ── stats aggregation ────────────────────────────────────────────────
export function computeStats({ applications, pipeline, scanHistory, states }) {
  const resolve = buildStatusResolver(states);

  // Status counts (canonical groups, in funnel order).
  // Dashboard action-tracking groups come first, then legacy evaluation groups.
  const order = ['no_action', 'linkedin_connect', 'referral', 'applied', 'not_eligible',
                 'evaluated', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'skip'];
  const statusCounts = Object.fromEntries(order.map(k => [k, 0]));
  for (const a of applications) {
    const s = resolve(a.status);
    const g = s ? s.dashboard_group : null;
    if (g && g in statusCounts) statusCounts[g]++;
  }

  // Score distribution buckets
  const buckets = { '0–1': 0, '1–2': 0, '2–3': 0, '3–4': 0, '4–5': 0 };
  const scored = applications.filter(a => typeof a.score === 'number');
  for (const a of scored) {
    const v = a.score;
    if (v < 1) buckets['0–1']++;
    else if (v < 2) buckets['1–2']++;
    else if (v < 3) buckets['2–3']++;
    else if (v < 4) buckets['3–4']++;
    else buckets['4–5']++;
  }
  const avgScore = scored.length ? scored.reduce((s, a) => s + a.score, 0) / scored.length : null;

  // Applications over time (by date)
  const overTime = {};
  for (const a of applications) if (a.date) overTime[a.date] = (overTime[a.date] || 0) + 1;

  // Scan activity over time (by first_seen)
  const scanByDate = {};
  for (const r of scanHistory) if (r.first_seen) scanByDate[r.first_seen] = (scanByDate[r.first_seen] || 0) + 1;

  // Top companies (applications + scan history union)
  const companyCounts = {};
  for (const a of applications) if (a.company) companyCounts[a.company] = (companyCounts[a.company] || 0) + 1;
  for (const r of pipeline.pending) if (r.company) companyCounts[r.company] = (companyCounts[r.company] || 0) + 1;
  const topCompanies = Object.entries(companyCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);

  // scan-history status breakdown
  const scanStatus = {};
  for (const r of scanHistory) scanStatus[r.status] = (scanStatus[r.status] || 0) + 1;

  return {
    kpis: {
      applications: applications.length,
      pipelinePending: pipeline.pending.length,
      scannedTotal: scanHistory.length,
      offers: statusCounts.offer,
      interviews: statusCounts.interview,
      applied: statusCounts.applied,
      avgScore,
    },
    statusCounts,
    statusOrder: order,
    scoreBuckets: buckets,
    overTime,
    scanByDate,
    topCompanies,
    scanStatus,
  };
}
