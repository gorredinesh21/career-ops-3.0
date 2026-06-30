#!/usr/bin/env node
// server.mjs — zero-dependency backend for the career-ops web dashboard.
//
// The career-ops data files are the database. This server reads them fresh on
// every request (so it always reflects the latest scan/evaluation the agent
// wrote) and serves JSON under /api/*. Static frontend is served from public/.
//
// Reuses career-ops' own js-yaml (resolved from the parent node_modules) — no
// `npm install` needed. Run from anywhere:
//   node dashboard-web/server.mjs           # port 4317
//   PORT=8080 node dashboard-web/server.mjs
//
// The only write path is PATCH /api/applications/:num, which updates the
// status/notes of an EXISTING row in data/applications.md (contract-safe —
// new rows must still go through the TSV + merge-tracker flow).

import http from 'http';
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  loadStates, buildStatusResolver, parseApplications, parsePipeline,
  parseScanHistory, parseReports, parseProfile, computeStats,
  parseDaily, listDailyDates,
} from './lib/parsers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const APPLICATIONS_PATH = path.join(REPO_ROOT, 'data', 'applications.md');
const PORT = process.env.PORT || 4317;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
};

// Serve a file from an allowed repo subdirectory (output/ for resume PDFs,
// reports/ for evaluation markdown). Path-traversal guarded; `download=1` forces
// a save dialog, otherwise the browser views inline (PDFs open in the viewer).
function serveRepoFile(req, res, subdir, allowedExt) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const name = urlPath.replace(new RegExp(`^/${subdir}/`), '');
  const baseDir = path.join(REPO_ROOT, subdir);
  const filePath = path.join(baseDir, path.normalize(name));
  if (!filePath.startsWith(baseDir)) { res.writeHead(403); res.end('forbidden'); return; }
  const ext = path.extname(filePath).toLowerCase();
  if (!allowedExt.includes(ext)) { res.writeHead(403); res.end('forbidden'); return; }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const download = /[?&]download=1/.test(req.url);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${path.basename(filePath)}"`,
    'Cache-Control': 'no-store',
  });
  createReadStream(filePath).pipe(res);
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function buildSnapshot() {
  const { states } = loadStates(REPO_ROOT);
  const applications = parseApplications(REPO_ROOT);
  const pipeline = parsePipeline(REPO_ROOT);
  const scanHistory = parseScanHistory(REPO_ROOT);
  const reports = parseReports(REPO_ROOT);
  const profile = parseProfile(REPO_ROOT);

  // Enrich each application with its apply URL + tailored-PDF file by joining
  // to the parsed report (matched on report filename). The report header is the
  // source of truth for both the JD link and the generated resume path.
  const byFile = new Map(reports.map(r => [r.file, r]));
  // Fallback apply-URL source: scan-history carries the URL for every scanned/ingested
  // role (incl. SKIP / low-score ones that never got a report). Match on company+role
  // so even skipped jobs show their apply link.
  const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const urlByCompanyRole = new Map();
  for (const r of scanHistory) {
    const key = `${norm(r.company)}::${norm(r.title)}`;
    if (r.url && !urlByCompanyRole.has(key)) urlByCompanyRole.set(key, r.url);
  }
  for (const a of applications) {
    const rep = a.reportFile ? byFile.get(a.reportFile) : null;
    a.applyUrl = rep && rep.url ? rep.url : null;
    a.pdfFile = rep && rep.pdfFile ? rep.pdfFile : null;
    if (!a.applyUrl) a.applyUrl = urlByCompanyRole.get(`${norm(a.company)}::${norm(a.role)}`) || null;
  }

  const stats = computeStats({ applications, pipeline, scanHistory, states });
  return {
    generatedAt: new Date().toISOString(),
    profile,
    states: states.map(s => ({ id: s.id, label: s.label, group: s.dashboard_group })),
    applications, pipeline, scanHistory, reports, stats,
  };
}

// Update Status (and optionally Notes) of an existing applications.md row.
function updateApplicationStatus(num, newStatus, newNotes) {
  if (!existsSync(APPLICATIONS_PATH)) throw new Error('applications.md not found');
  const { states } = loadStates(REPO_ROOT);
  const resolve = buildStatusResolver(states);
  const canonical = resolve(newStatus);
  if (!canonical) throw new Error(`invalid status: ${newStatus}`);

  const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
  const lines = text.split('\n');
  let updated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
    if (cells.length < 6) continue;
    if (cells[0] !== String(num)) continue;
    // Columns: # | Date | Company | Role | Score | Status | PDF | Report | Notes
    cells[5] = canonical.label;
    if (typeof newNotes === 'string' && cells.length >= 9) cells[8] = newNotes.replace(/\|/g, '/');
    lines[i] = `| ${cells.join(' | ')} |`;
    updated = true;
    break;
  }
  if (!updated) throw new Error(`application #${num} not found`);
  writeFileSync(APPLICATIONS_PATH, lines.join('\n'), 'utf-8');
  return true;
}

// Upsert a tracker row from the Daily-jobs table. Matches an EXISTING row by
// normalized company+role; if none, CREATES a new row (num = max+1) so the job
// shows up in Job postings with the chosen status. This is the one write path
// that may add rows — guarded to the 5 canonical states and de-duped on
// company+role so repeated clicks don't pile up duplicates.
function normCR(company, role) {
  const n = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `${n(company)}::${n(role)}`;
}

function trackDailyJob({ company, role, url, date, status }) {
  if (!company && !role) throw new Error('company or role required');
  const { states } = loadStates(REPO_ROOT);
  const resolve = buildStatusResolver(states);
  const canonical = resolve(status);
  if (!canonical) throw new Error(`invalid status: ${status}`);

  if (!existsSync(APPLICATIONS_PATH)) throw new Error('applications.md not found');
  const text = readFileSync(APPLICATIONS_PATH, 'utf-8');
  const lines = text.split('\n');
  const clean = (s) => String(s == null ? '' : s).replace(/\|/g, '/').trim();
  const wantKey = normCR(company, role);

  let maxNum = 0;
  let lastRowIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    const cells = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
    if (cells.length < 6) continue;
    if (cells[0].toLowerCase() === '#' || cells[0].toLowerCase() === 'num') continue;
    if (/^[\s:|-]+$/.test(cells[0])) continue; // separator
    lastRowIdx = i;
    const n = parseInt(cells[0], 10);
    if (!Number.isNaN(n) && n > maxNum) maxNum = n;
    // Columns: # | Date | Company | Role | Score | Status | PDF | Report | Notes
    if (normCR(cells[2], cells[3]) === wantKey) {
      cells[5] = canonical.label;
      lines[i] = `| ${cells.join(' | ')} |`;
      writeFileSync(APPLICATIONS_PATH, lines.join('\n'), 'utf-8');
      return { ok: true, num: cells[0], created: false };
    }
  }

  // No match → create a new row.
  const num = maxNum + 1;
  const row = `| ${num} | ${clean(date) || new Date().toISOString().slice(0, 10)} | ${clean(company) || '—'} | ${clean(role) || '—'} | — | ${canonical.label} | ❌ | — | added via dashboard${url ? ` — ${clean(url)}` : ''} |`;
  if (lastRowIdx === -1) {
    lines.push(row);
  } else {
    lines.splice(lastRowIdx + 1, 0, row);
  }
  writeFileSync(APPLICATIONS_PATH, lines.join('\n'), 'utf-8');
  return { ok: true, num: String(num), created: true };
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  // Prevent path traversal outside public/
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('forbidden'); return; }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) { res.writeHead(404); res.end('not found'); return; }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
}

// career-ops-3.0 sidecar: ratings + tailoring metadata written by lc/rate-jobs.mjs.
// Read fresh per request; keeps the tracker schema untouched (enrichment only).
const EVAL_META_PATH = path.join(REPO_ROOT, 'data', 'eval-meta.json');
function loadEvalMeta() {
  try {
    return existsSync(EVAL_META_PATH) ? JSON.parse(readFileSync(EVAL_META_PATH, 'utf-8')) : {};
  } catch { return {}; }
}
// Attach best_score / best_resume / min_experience_required to a daily job by
// matching on url first, then company::title.
function enrichWithEval(jobs, meta) {
  return jobs.map((j) => {
    const m = meta[j.url] || meta[`${j.company}::${j.title}`];
    if (!m) return j;
    return {
      ...j,
      best_score: m.best_score,
      best_resume: m.best_resume,
      best_verdict: m.best_verdict,
      min_experience_required: m.min_experience_required,
    };
  });
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  try {
    // career-ops-3.0: full ratings sidecar (best score + which resume + gaps).
    if (req.method === 'GET' && url === '/api/eval-meta') {
      return sendJson(res, 200, loadEvalMeta());
    }

    if (req.method === 'GET' && url === '/api/data') {
      return sendJson(res, 200, buildSnapshot());
    }

    // Daily job table: rich Apify rows + that day's scan-history (company sites /
    // Telegram). ?date=YYYY-MM-DD; defaults to the most recent day with data.
    if (req.method === 'GET' && url === '/api/daily') {
      const dates = listDailyDates(REPO_ROOT);
      const qs = new URL(req.url, 'http://localhost').searchParams;
      const date = qs.get('date') || dates[0] || new Date().toISOString().slice(0, 10);
      const jobs = enrichWithEval(parseDaily(REPO_ROOT, date), loadEvalMeta());
      return sendJson(res, 200, { date, availableDates: dates, jobs });
    }

    // Daily-jobs status: upsert a tracker row (create if the job isn't tracked yet).
    if (req.method === 'POST' && url === '/api/track') {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const { company, role, url: jobUrl, date, status } = JSON.parse(body || '{}');
          const result = trackDailyJob({ company, role, url: jobUrl, date, status });
          sendJson(res, 200, result);
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }

    const patchMatch = url.match(/^\/api\/applications\/([^/]+)$/);
    if (req.method === 'PATCH' && patchMatch) {
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const { status, notes } = JSON.parse(body || '{}');
          updateApplicationStatus(patchMatch[1], status, notes);
          sendJson(res, 200, { ok: true });
        } catch (e) {
          sendJson(res, 400, { ok: false, error: e.message });
        }
      });
      return;
    }

    if (url.startsWith('/api/')) return sendJson(res, 404, { error: 'unknown endpoint' });

    // Tailored resume PDFs and evaluation reports (read-only, guarded).
    if (req.method === 'GET' && url.startsWith('/output/')) return serveRepoFile(req, res, 'output', ['.pdf']);
    if (req.method === 'GET' && url.startsWith('/reports/')) return serveRepoFile(req, res, 'reports', ['.md']);

    return serveStatic(req, res);
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  career-ops dashboard → http://localhost:${PORT}`);
  console.log(`  reading data from: ${REPO_ROOT}`);
  console.log(`  (Ctrl+C to stop)\n`);
});
