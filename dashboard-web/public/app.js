// app.js — fetches /api/data and renders the dashboard. No build step.
const charts = {};
let STATES = [];
let APPS = []; // latest applications snapshot, for matching daily jobs → tracker rows

// The 5 action-tracking statuses shown in BOTH the Daily-jobs and Job-postings
// dropdowns (replaces the raw canonical list in the UI). "No Action Taken" is
// the default for any row that hasn't been acted on yet.
const ACTION_STATES = ['No Action Taken', 'Sent LinkedIn Connect', 'Sent Referral Message', 'Applied', 'Not Eligible'];

// Collapse any stored status (canonical or legacy eval state) to one of the 5.
function toAction(s) {
  const k = (s || '').toLowerCase().trim();
  const exact = ACTION_STATES.find(a => a.toLowerCase() === k);
  if (exact) return exact;
  if (['skip', 'rejected', 'discarded', 'rechazado', 'descartado', 'not_eligible'].includes(k)) return 'Not Eligible';
  if (['sent', 'aplicado', 'aplicada', 'enviada'].includes(k)) return 'Applied';
  return 'No Action Taken';
}

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const COLORS = ['#5b9cff', '#3fb950', '#bc8cff', '#d29922', '#f85149', '#56d4dd', '#e3b341', '#8a93a6'];
const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Normalize a URL for matching (drop query/hash, trailing slash, lowercase).
const normUrl = (u) => { if (!u) return ''; try { const x = new URL(u); return (x.host + x.pathname).replace(/\/$/, '').toLowerCase(); } catch { return String(u).split('?')[0].split('#')[0].replace(/\/$/, '').toLowerCase(); } };
const normCR = (c, r) => `${(c || '').toLowerCase().replace(/\s+/g, ' ').trim()}::${(r || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;

// Find the tracker row (if any) that corresponds to a daily job.
function matchApp(job) {
  const ju = normUrl(job.url || job.applyUrl);
  if (ju) { const byUrl = APPS.find(a => a.applyUrl && normUrl(a.applyUrl) === ju); if (byUrl) return byUrl; }
  const key = normCR(job.company, job.title);
  return APPS.find(a => normCR(a.company, a.role) === key) || null;
}

// Build a status <select> limited to the 5 action states.
function actionSelect(current, onChange) {
  const sel = el('select', 'status');
  const cur = toAction(current);
  for (const s of ACTION_STATES) {
    const o = el('option', '', s); o.value = s;
    if (s === cur) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

async function load() {
  let data;
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    data = await r.json();
  } catch (e) {
    $('#updated').textContent = 'backend offline';
    return;
  }
  STATES = data.states || [];
  APPS = data.applications || [];
  renderHeader(data);
  renderKpis(data.stats.kpis);
  renderFunnel(data.stats, data.states);
  renderCharts(data.stats);
  renderApplications(data.applications);
  renderPipeline(data.pipeline);
  loadDaily(dailyDateSel);
  $('#updated').textContent = 'updated ' + new Date(data.generatedAt).toLocaleTimeString();
}

// ── Daily jobs table (rich Apify rows + that day's scan-history) ──────
let dailyDateSel = null; // currently selected day; null = let server pick latest

async function loadDaily(date) {
  let res;
  try {
    const q = date ? ('?date=' + encodeURIComponent(date)) : '';
    const r = await fetch('/api/daily' + q, { cache: 'no-store' });
    res = await r.json();
  } catch (e) { return; }
  dailyDateSel = res.date;

  const dsel = $('#dailyDate');
  dsel.innerHTML = '';
  const days = res.availableDates && res.availableDates.length ? res.availableDates : [res.date];
  for (const d of days) {
    const o = el('option', '', d); o.value = d;
    if (d === res.date) o.selected = true;
    dsel.append(o);
  }
  renderDaily(res.jobs || []);
}

function renderDaily(jobs) {
  // Source filter options (preserve current choice across refreshes).
  const srcSel = $('#dailySource');
  const curSrc = srcSel.value;
  srcSel.innerHTML = '<option value="">all sources</option>';
  for (const s of [...new Set(jobs.map(j => j.source).filter(Boolean))].sort()) {
    const o = el('option', '', s); o.value = s; if (s === curSrc) o.selected = true; srcSel.append(o);
  }

  const draw = (rows) => {
    const tbody = $('#dailyTable tbody'); tbody.innerHTML = '';
    for (const j of rows) {
      const tr = el('tr');
      tr.append(el('td', '', `<span class="src-tag">${esc(j.source) || '—'}</span>`));
      const titleHtml = j.url
        ? `<a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title) || '—'}</a>`
        : (esc(j.title) || '—');
      tr.append(el('td', 'role', titleHtml));
      tr.append(el('td', '', esc(j.company) || '—'));
      tr.append(el('td', '', esc(j.location) || '—'));
      tr.append(el('td', '', esc(j.seniorityLevel) || '—'));
      tr.append(el('td', '', esc(j.employmentType) || '—'));
      tr.append(el('td', '', esc(j.salary) || '—'));
      tr.append(el('td', '', esc(j.postedAt) || '—'));
      tr.append(el('td', '', j.applicantsCount !== '' && j.applicantsCount != null ? esc(j.applicantsCount) : '—'));
      const apply = j.applyUrl || j.url;
      tr.append(el('td', '', apply ? `<a class="link-apply" href="${esc(apply)}" target="_blank" rel="noopener">Apply ↗</a>` : '—'));
      // Status: reflects the matching tracker row (or "No Action Taken"); changing
      // it updates that row, or creates one if this job isn't tracked yet.
      const stTd = el('td');
      const matched = matchApp(j);
      stTd.append(actionSelect(matched ? matched.status : 'No Action Taken', (val) => setDailyStatus(j, matched, val)));
      tr.append(stTd);
      tbody.append(tr);
    }
    $('#dailyCount').textContent = `${rows.length}/${jobs.length}`;
    const empty = $('#dailyEmpty');
    empty.style.display = rows.length ? 'none' : 'block';
    empty.textContent = rows.length ? '' : (jobs.length ? 'No jobs match the current filters.' : 'No jobs for this day yet. Run apify-scan.mjs / scan.mjs.');
  };

  const apply = () => {
    const q = ($('#dailySearch').value || '').toLowerCase();
    const s = $('#dailySource').value || '';
    draw(jobs.filter(j => {
      if (q && !((j.title + ' ' + j.company + ' ' + j.location).toLowerCase().includes(q))) return false;
      if (s && j.source !== s) return false;
      return true;
    }));
  };

  $('#dailySearch').oninput = apply;
  $('#dailySource').onchange = apply;
  apply();
}

$('#dailyDate').addEventListener('change', (e) => loadDaily(e.target.value));

function renderHeader(d) {
  $('#name').textContent = (d.profile && d.profile.name) || 'career-ops';
  const h = (d.profile && d.profile.headline) || '';
  const loc = (d.profile && d.profile.location) ? ' · ' + d.profile.location : '';
  $('#headline').textContent = h + loc;
}

function renderKpis(k) {
  const cards = [
    { l: 'Applications', v: k.applications, cls: 'accent' },
    { l: 'Pending in pipeline', v: k.pipelinePending, cls: 'amber' },
    { l: 'Roles scanned', v: k.scannedTotal, cls: '' },
    { l: 'Applied', v: k.applied, cls: 'accent' },
    { l: 'Interviews', v: k.interviews, cls: 'purple' },
    { l: 'Offers', v: k.offers, cls: 'green' },
    { l: 'Avg score', v: k.avgScore == null ? '—' : k.avgScore.toFixed(1), cls: '' },
  ];
  const g = $('#kpis'); g.innerHTML = '';
  for (const c of cards) {
    const e = el('div', 'kpi ' + c.cls);
    e.append(el('div', 'v', String(c.v)), el('div', 'l', c.l));
    g.append(e);
  }
}

function renderFunnel(stats, states) {
  const labelOf = {}; for (const s of states) labelOf[s.group] = s.label;
  const f = $('#funnel'); f.innerHTML = '';
  for (const g of stats.statusOrder) {
    const stage = el('div', 'stage'); stage.dataset.g = g;
    stage.append(el('div', 'n', String(stats.statusCounts[g] || 0)), el('div', 's', labelOf[g] || g));
    f.append(stage);
  }
}

function makeChart(id, fallbackId, cfg, fallbackHtml) {
  if (typeof Chart === 'undefined') {
    $('#' + id).style.display = 'none';
    $('#' + fallbackId).innerHTML = fallbackHtml || 'Chart library unavailable (offline).';
    return;
  }
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart($('#' + id), cfg);
}

function renderCharts(stats) {
  const baseOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8a93a6', font: { size: 11 } } } },
    scales: {
      x: { ticks: { color: '#8a93a6' }, grid: { color: '#283145' } },
      y: { ticks: { color: '#8a93a6' }, grid: { color: '#283145' }, beginAtZero: true },
    },
  };

  // Status doughnut
  const sLabels = stats.statusOrder.filter(g => stats.statusCounts[g] > 0);
  const sData = sLabels.map(g => stats.statusCounts[g]);
  makeChart('statusChart', 'statusFallback', {
    type: 'doughnut',
    data: { labels: sLabels, datasets: [{ data: sData, backgroundColor: COLORS, borderColor: '#0b0e14', borderWidth: 2 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#8a93a6', font: { size: 11 } } } } },
  }, sData.length ? '' : 'No evaluated applications yet.');

  // Score histogram
  const scLabels = Object.keys(stats.scoreBuckets);
  const scData = Object.values(stats.scoreBuckets);
  makeChart('scoreChart', 'scoreFallback', {
    type: 'bar',
    data: { labels: scLabels, datasets: [{ label: 'roles', data: scData, backgroundColor: '#5b9cff', borderRadius: 6 }] },
    options: { ...baseOpts, plugins: { legend: { display: false } } },
  }, scData.some(Boolean) ? '' : 'No scored applications yet.');

  // Scan activity over time
  const scanDates = Object.keys(stats.scanByDate).sort();
  makeChart('scanChart', 'scanFallback', {
    type: 'line',
    data: { labels: scanDates, datasets: [{ label: 'roles scanned', data: scanDates.map(d => stats.scanByDate[d]), borderColor: '#3fb950', backgroundColor: 'rgba(63,185,80,.15)', fill: true, tension: .3 }] },
    options: { ...baseOpts, plugins: { legend: { display: false } } },
  }, scanDates.length ? '' : 'No scan history yet.');

  // Top companies
  const co = stats.topCompanies;
  makeChart('companyChart', 'companyFallback', {
    type: 'bar',
    data: { labels: co.map(c => c[0]), datasets: [{ label: 'roles', data: co.map(c => c[1]), backgroundColor: '#bc8cff', borderRadius: 6 }] },
    options: { ...baseOpts, indexAxis: 'y', plugins: { legend: { display: false } } },
  }, co.length ? '' : 'No companies tracked yet.');
}

function scoreClass(v) { return v == null ? '' : v >= 4 ? 'score-hi' : v >= 3 ? 'score-mid' : 'score-lo'; }

function renderApplications(apps) {
  const tbody = $('#appTable tbody');
  const empty = $('#appEmpty');
  const count = $('#appCount');

  // Populate the status filter once from the live data (canonical labels present).
  const statusSel = $('#statusFilter');
  if (statusSel.options.length <= 1) {
    const seen = new Set(apps.map(a => (a.status || '').trim()).filter(Boolean));
    for (const s of seen) { const o = el('option', '', s); o.value = s; statusSel.append(o); }
  }

  const draw = (rows) => {
    tbody.innerHTML = '';
    for (const a of rows) {
      const tr = el('tr');
      tr.append(el('td', '', a.num));
      tr.append(el('td', '', a.date || '—'));
      tr.append(el('td', '', a.company || '—'));
      tr.append(el('td', 'role', a.role || '—'));
      tr.append(el('td', '', a.score == null ? '—' : `<span class="score-badge ${scoreClass(a.score)}">${a.score.toFixed(1)}</span>`));
      // status editor (limited to the 5 action states)
      const stTd = el('td');
      stTd.append(actionSelect(a.status, (val) => updateStatus(a.num, val)));
      tr.append(stTd);
      // Apply link (JD URL from the report header)
      tr.append(el('td', '', a.applyUrl ? `<a class="link-apply" href="${a.applyUrl}" target="_blank" rel="noopener">Apply ↗</a>` : '—'));
      // Resume: view (inline) + download, when a tailored PDF exists
      const resTd = el('td');
      if (a.pdfFile) {
        const enc = encodeURIComponent(a.pdfFile);
        resTd.innerHTML = `<a class="btn-mini" href="/output/${enc}" target="_blank" rel="noopener">View</a>` +
                          `<a class="btn-mini ghost" href="/output/${enc}?download=1">Download</a>`;
      } else {
        resTd.innerHTML = '<span class="muted small">—</span>';
      }
      tr.append(resTd);
      tr.append(el('td', '', a.report ? `<a href="${a.report}" target="_blank">report</a>`
                              : (a.reportFile ? `<a href="/reports/${encodeURIComponent(a.reportFile)}" target="_blank">report</a>` : '—')));
      tr.append(el('td', 'notes', a.notes || ''));
      tbody.append(tr);
    }
    count.textContent = `${rows.length}/${apps.length}`;
    empty.style.display = rows.length ? 'none' : 'block';
    empty.textContent = rows.length ? '' : (apps.length ? 'No postings match the current filters.' : 'No evaluations yet. Run /career-ops pipeline to populate this.');
  };

  const apply = () => {
    const q = ($('#appSearch').value || '').toLowerCase();
    const st = ($('#statusFilter').value || '').toLowerCase();
    const minScore = parseFloat($('#scoreFilter').value) || 0;
    const needResume = $('#resumeFilter').checked;
    draw(apps.filter(a => {
      if (q && !(a.company + ' ' + a.role).toLowerCase().includes(q)) return false;
      if (st && (a.status || '').toLowerCase() !== st) return false;
      if (minScore && !(typeof a.score === 'number' && a.score >= minScore)) return false;
      if (needResume && !a.pdfFile) return false;
      return true;
    }));
  };

  $('#appSearch').oninput = apply;
  $('#statusFilter').onchange = apply;
  $('#scoreFilter').onchange = apply;
  $('#resumeFilter').onchange = apply;
  apply();
}

async function updateStatus(num, status) {
  try {
    const r = await fetch('/api/applications/' + encodeURIComponent(num), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) { const j = await r.json(); alert('Update failed: ' + (j.error || r.status)); return; }
    await load(); // refresh both tables so Daily jobs ↔ Job postings stay in sync
  } catch (e) { alert('Update failed: ' + e.message); }
}

// Daily-jobs status change: update the matched tracker row, or create one.
async function setDailyStatus(job, matched, status) {
  try {
    if (matched && matched.num) return updateStatus(matched.num, status);
    const r = await fetch('/api/track', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: job.company, role: job.title,
        url: job.url || job.applyUrl, date: dailyDateSel, status,
      }),
    });
    if (!r.ok) { const j = await r.json(); alert('Update failed: ' + (j.error || r.status)); return; }
    await load(); // new row now appears in Job postings; daily dropdown re-matches it
  } catch (e) { alert('Update failed: ' + e.message); }
}

function renderPipeline(p) {
  const rows = p.pending || [];
  $('#pipeCount').textContent = rows.length + ' pending';
  const tbody = $('#pipeTable tbody'); tbody.innerHTML = '';
  const empty = $('#pipeEmpty');
  empty.style.display = rows.length ? 'none' : 'block';
  empty.textContent = rows.length ? '' : 'Pipeline empty. Run /career-ops scan to discover roles.';
  for (const r of rows) {
    const tr = el('tr');
    tr.append(el('td', '', r.company || '—'));
    tr.append(el('td', 'role', r.title || '—'));
    tr.append(el('td', '', r.url ? `<a href="${r.url}" target="_blank">open ↗</a>` : '—'));
    tbody.append(tr);
  }
}

// auto-refresh
let timer = null;
function setAuto(on) {
  if (timer) { clearInterval(timer); timer = null; }
  if (on) timer = setInterval(load, 15000);
}
$('#autorefresh').addEventListener('change', (e) => setAuto(e.target.checked));
$('#refresh').addEventListener('click', load);

load();
setAuto(true);
