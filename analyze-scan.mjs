#!/usr/bin/env node
/**
 * analyze-scan.mjs — one-off analysis of the RAW job listings across the
 * verified ATS boards in portals.yml. scan.mjs filters + discards the raw
 * set; this re-fetches it and aggregates by company, city, role family,
 * seniority, and region. Emits a console summary + a self-contained HTML
 * chart page (output/scan-analysis-<date>.html).
 *
 * Run: NODE_OPTIONS=--use-system-ca node analyze-scan.mjs
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import path from 'path';
import yaml from 'js-yaml';
import { makeHttpCtx } from './providers/_http.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PROVIDERS_DIR = path.resolve(__dir, 'providers');
const PORTALS = process.env.CAREER_OPS_PORTALS || 'portals.yml';
const DATE = new Date().toISOString().slice(0, 10);

// ── load providers (mirrors scan.mjs) ──
async function loadProviders(dir) {
  const providers = new Map();
  const files = readdirSync(dir).filter(f => f.endsWith('.mjs') && !f.startsWith('_')).sort();
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    const p = mod.default;
    if (p && typeof p.fetch === 'function' && p.id && !providers.has(p.id)) providers.set(p.id, p);
  }
  return providers;
}
function resolveProvider(entry, providers) {
  if (entry.provider) return providers.get(entry.provider) || null;
  const lp = providers.get('local-parser');
  if (lp) { try { if (lp.detect?.(entry)) return lp; } catch {} }
  for (const p of providers.values()) {
    try { if (p.detect?.(entry)) return p; } catch {}
  }
  return null;
}

// ── classifiers ──
const CITIES = [
  ['Bengaluru', ['bengaluru', 'bangalore']],
  ['Hyderabad', ['hyderabad']],
  ['Mumbai', ['mumbai']],
  ['Pune', ['pune']],
  ['Gurugram', ['gurugram', 'gurgaon']],
  ['Delhi/NCR', ['delhi', 'noida', 'ncr']],
  ['Chennai', ['chennai']],
  ['Kolkata', ['kolkata']],
  ['Ahmedabad', ['ahmedabad']],
  ['Jaipur', ['jaipur']],
];
function cityOf(loc) {
  const l = (loc || '').toLowerCase().trim();
  if (!l) return 'Unspecified';
  for (const [name, keys] of CITIES) if (keys.some(k => l.includes(k))) return name;
  if (l.includes('remote')) return 'Remote';
  if (l.includes('india')) return 'India (other)';
  // crude non-India detection
  const nonIndia = ['united states', 'usa', ' us', 'uk', 'london', 'singapore', 'dubai', 'germany', 'canada', 'remote - us', 'new york', 'san francisco', 'europe', 'emea', 'apac', 'australia', 'manila', 'jakarta'];
  if (nonIndia.some(k => l.includes(k))) return 'Non-India';
  return 'Other';
}
const INDIA_CITY = new Set(['Bengaluru','Hyderabad','Mumbai','Pune','Gurugram','Delhi/NCR','Chennai','Kolkata','Ahmedabad','Jaipur','India (other)']);

function roleFamily(title) {
  const t = (title || '').toLowerCase();
  const has = (...ks) => ks.some(k => t.includes(k));
  if (has('machine learning', ' ml ', 'ml engineer', 'ai engineer', '(ai', 'applied scientist', 'deep learning', 'nlp', 'computer vision', 'genai', 'generative ai', 'llm')) return 'AI / ML';
  if (has('data scientist', 'data science', 'analytics', 'data analyst', 'decision scien')) return 'Data Science / Analytics';
  if (has('data engineer', 'data platform', 'analytics engineer', 'etl', 'big data')) return 'Data Engineering';
  if (has('forward deployed', 'solutions engineer', 'sales engineer', 'solution architect', 'implementation')) return 'Solutions / Forward Deployed';
  if (has('software', 'sde', 'developer', 'backend', 'frontend', 'full stack', 'fullstack', 'engineer', 'sre', 'devops', 'platform', 'qa', 'mobile', 'android', 'ios')) return 'Software Engineering';
  if (has('product manager', 'product management', ' pm ', 'group product', 'apm')) return 'Product';
  if (has('design', 'ux', 'ui ')) return 'Design';
  if (has('sales', 'account', 'business development', 'gtm', 'revenue', 'partnership')) return 'Sales / GTM';
  if (has('market', 'growth', 'content', 'brand', 'social media', 'seo')) return 'Marketing / Growth';
  if (has('finance', 'accountant', 'legal', 'counsel', 'compliance', 'audit', 'tax')) return 'Finance / Legal';
  if (has('people', 'recruit', 'talent', 'hr ', 'human resource')) return 'People / HR';
  if (has('operations', 'ops ', 'program manager', 'project manager', 'support', 'customer success')) return 'Ops / Program / Support';
  return 'Other';
}
function seniority(title) {
  const t = (title || '').toLowerCase();
  if (/\b(intern|internship|trainee|graduate|campus|apprentice)\b/.test(t)) return 'Intern / Grad';
  if (/\b(vp|vice president|head|director|chief|principal|staff|distinguished|sr\.? staff)\b/.test(t)) return 'Leadership / Staff+';
  if (/\b(senior|sr\.?|lead|manager|iii|iv|architect)\b/.test(t)) return 'Senior / Lead';
  if (/\b(ii|2|associate|mid)\b/.test(t)) return 'Mid';
  return 'Unspecified / IC';
}

// ── title filter from portals.yml (to show "relevant to Dinesh") ──
function makeTitleFilter(tf) {
  const pos = (tf?.positive || []).map(k => k.toLowerCase());
  const neg = (tf?.negative || []).map(k => k.toLowerCase());
  return (title) => {
    const l = (title || '').toLowerCase();
    const hp = pos.length === 0 || pos.some(k => l.includes(k));
    const hn = neg.some(k => l.includes(k));
    return hp && !hn;
  };
}

// ── aggregate helper ──
function tally(arr, keyFn) {
  const m = new Map();
  for (const x of arr) { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function bar(n, max, width = 30) {
  const len = max === 0 ? 0 : Math.round((n / max) * width);
  return '█'.repeat(len) + '·'.repeat(width - len);
}
function printTable(title, pairs, total) {
  console.log(`\n${title}`);
  console.log('─'.repeat(60));
  const max = Math.max(...pairs.map(p => p[1]), 1);
  for (const [k, n] of pairs) {
    const pct = ((n / total) * 100).toFixed(1).padStart(5);
    console.log(`${String(k).padEnd(26)} ${String(n).padStart(4)} ${pct}%  ${bar(n, max, 24)}`);
  }
}

async function main() {
  const providers = await loadProviders(PROVIDERS_DIR);
  const config = yaml.load(readFileSync(PORTALS, 'utf-8'));
  const companies = (config.tracked_companies || []).filter(c => c && typeof c === 'object' && c.enabled !== false && c.name);
  const titleFilter = makeTitleFilter(config.title_filter);

  const jobs = [];
  const errors = [];
  await Promise.all(companies.map(async (c) => {
    const provider = resolveProvider(c, providers);
    if (!provider) return;
    try {
      const ctx = makeHttpCtx();
      const list = await provider.fetch(c, ctx);
      if (Array.isArray(list)) for (const j of list) jobs.push({ company: c.name, title: j.title || '', location: j.location || '', url: j.url || '' });
    } catch (e) { errors.push(`${c.name}: ${e.message}`); }
  }));

  const total = jobs.length;
  const byCompany = tally(jobs, j => j.company);
  const byCity = tally(jobs, j => cityOf(j.location));
  const byFamily = tally(jobs, j => roleFamily(j.title));
  const bySeniority = tally(jobs, j => seniority(j.title));
  const indiaCount = jobs.filter(j => INDIA_CITY.has(cityOf(j.location))).length;
  const remoteCount = jobs.filter(j => cityOf(j.location) === 'Remote').length;
  const relevant = jobs.filter(j => titleFilter(j.title));
  const relevantCities = tally(relevant, j => cityOf(j.location));

  // distinct India cities
  const distinctCities = byCity.filter(([c]) => INDIA_CITY.has(c) && c !== 'India (other)');

  console.log(`\n${'━'.repeat(60)}`);
  console.log(`Scan Analysis — ${DATE}   (${total} raw listings, ${companies.length} boards)`);
  console.log('━'.repeat(60));
  console.log(`India-based: ${indiaCount}  |  Remote: ${remoteCount}  |  Relevant to profile (title filter): ${relevant.length}`);
  console.log(`Distinct named Indian cities: ${distinctCities.length} → ${distinctCities.map(c => c[0]).join(', ') || 'none'}`);
  if (errors.length) console.log(`Errors: ${errors.length} → ${errors.join(' | ')}`);

  printTable('By City / Location', byCity, total);
  printTable('By Company (board)', byCompany, total);
  printTable('By Role Family', byFamily, total);
  printTable('By Seniority (from title)', bySeniority, total);
  printTable('Relevant-to-profile jobs, by city', relevantCities, relevant.length || 1);

  // ── HTML viz ──
  mkdirSync('output', { recursive: true });
  const htmlPath = path.join('output', `scan-analysis-${DATE}.html`);
  const data = { total, companies: companies.length, indiaCount, remoteCount, relevant: relevant.length, distinctCities: distinctCities.map(c=>c[0]), byCity, byCompany, byFamily, bySeniority, relevantCities };
  writeFileSync(htmlPath, htmlPage(data));
  console.log(`\n✅ Interactive charts: ${htmlPath}`);
  writeFileSync(path.join('output', `scan-analysis-${DATE}.json`), JSON.stringify(data, null, 2));

  // ── full per-job dump with classifications (for in-depth filtering) ──
  const dump = jobs.map(x => ({
    company: x.company, title: x.title, location: x.location, url: x.url,
    city: cityOf(x.location), family: roleFamily(x.title), seniority: seniority(x.title),
    relevant: titleFilter(x.title),
  }));
  writeFileSync(path.join('output', `scan-jobs-${DATE}.json`), JSON.stringify(dump, null, 2));
  console.log(`✅ Per-job dump: output/scan-jobs-${DATE}.json (${dump.length} rows)`);
}

function htmlPage(d) {
  const j = JSON.stringify(d);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Scan Analysis ${DATE}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<style>
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1117;color:#e6e6e6;margin:0;padding:28px;}
  h1{font-size:20px;margin:0 0 4px;} .sub{color:#8a8fa3;font-size:13px;margin-bottom:20px;}
  .kpis{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:24px;}
  .kpi{background:#1a1d29;border:1px solid #262a3a;border-radius:10px;padding:14px 18px;min-width:120px;}
  .kpi .v{font-size:26px;font-weight:700;color:#4dd4c4;} .kpi .l{font-size:11px;color:#8a8fa3;text-transform:uppercase;letter-spacing:.05em;}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;}
  .card{background:#1a1d29;border:1px solid #262a3a;border-radius:12px;padding:18px;}
  .card h2{font-size:14px;margin:0 0 14px;color:#c9b8ff;} .full{grid-column:1/-1;}
  @media(max-width:900px){.grid{grid-template-columns:1fr;}}
</style></head><body>
<h1>Career-Ops Scan Analysis — ${DATE}</h1>
<div class="sub">Raw listings across ${d.companies} verified India ATS boards (before title/location filtering). Distinct Indian cities: ${d.distinctCities.join(', ')}</div>
<div class="kpis">
  <div class="kpi"><div class="v">${d.total}</div><div class="l">Raw jobs</div></div>
  <div class="kpi"><div class="v">${d.indiaCount}</div><div class="l">India-based</div></div>
  <div class="kpi"><div class="v">${d.remoteCount}</div><div class="l">Remote</div></div>
  <div class="kpi"><div class="v">${d.distinctCities.length}</div><div class="l">Indian cities</div></div>
  <div class="kpi"><div class="v">${d.relevant}</div><div class="l">Relevant to profile</div></div>
</div>
<div class="grid">
  <div class="card"><h2>By City / Location</h2><canvas id="city"></canvas></div>
  <div class="card"><h2>By Role Family</h2><canvas id="family"></canvas></div>
  <div class="card"><h2>By Company (board)</h2><canvas id="company"></canvas></div>
  <div class="card"><h2>By Seniority (from title)</h2><canvas id="sen"></canvas></div>
  <div class="card full"><h2>Profile-relevant jobs, by city</h2><canvas id="rel" height="80"></canvas></div>
</div>
<script>
const D=${j};
const palette=['#4dd4c4','#7c6cff','#ffb454','#ff6b8a','#5aa9ff','#9d6cff','#52d273','#f0c14b','#e07a5f','#8a8fa3','#c9b8ff','#3ddad7'];
function hbar(id,pairs,horizontal){
  new Chart(document.getElementById(id),{type:'bar',
    data:{labels:pairs.map(p=>p[0]),datasets:[{data:pairs.map(p=>p[1]),backgroundColor:palette,borderRadius:5}]},
    options:{indexAxis:horizontal?'y':'x',plugins:{legend:{display:false}},
      scales:{x:{ticks:{color:'#8a8fa3'},grid:{color:'#23263400'}},y:{ticks:{color:'#cfd3e0'},grid:{color:'#262a3a'}}}}});
}
hbar('city',D.byCity,true);
hbar('family',D.byFamily,true);
hbar('company',D.byCompany,true);
hbar('sen',D.bySeniority,false);
hbar('rel',D.relevantCities,false);
</script></body></html>`;
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
