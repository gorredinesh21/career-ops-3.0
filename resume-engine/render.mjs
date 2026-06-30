#!/usr/bin/env node
/**
 * render.mjs — career-ops resume engine (ported from CareerOS / JOB_APPLICATION_HANDLER-).
 *
 * Pattern: structured JSON data -> LaTeX (Dinesh's exact one-page look) -> PDF via a
 * real LaTeX compiler (pdflatex preferred, like CareerOS). Per-job tailoring = pass a
 * `--job overrides.json` that deep-merges onto base_resume.json (reorder/tweak projects,
 * bullet points, skills, or add a one-line `summary`). Facts (name, education, companies,
 * project titles, repo links) stay from the base unless explicitly overridden.
 *
 * JSON string values are treated as RAW LaTeX (so \textbf{...}, $\rightarrow$ work). If you
 * add literal & % # _ etc., escape them yourself in the JSON.
 *
 * Usage:
 *   node resume-engine/render.mjs                          # base resume -> output/cv-<slug>-base.pdf
 *   node resume-engine/render.mjs --job jobs/razorpay.json --name razorpay-fde
 *   LATEX_COMPILER=xelatex node resume-engine/render.mjs ...
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BASE_JSON = path.join(__dirname, 'base_resume.json');
const BUILD_DIR = path.join(__dirname, 'build');
const OUTPUT_DIR = path.join(REPO_ROOT, 'output');

// ── args ─────────────────────────────────────────────────────────────
function arg(flag) { const i = process.argv.indexOf(flag); return i !== -1 ? process.argv[i + 1] : null; }
const jobFile = arg('--job');
let nameSlug = arg('--name');

// ── deep merge (objects merge; arrays & scalars from override replace) ──
function deepMerge(base, over) {
  if (Array.isArray(over) || typeof over !== 'object' || over === null) return over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    out[k] = (k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

// ── LaTeX builders (mirror cv.tex macros exactly) ────────────────────
function headerBlock(d) {
  return `\\begin{center}

{\\Huge\\textbf{${d.name}}}

\\vspace{6pt}

\\small
\\faPhone\\ ${d.phone}
\\quad | \\quad
\\faEnvelope\\ \\href{mailto:${d.email}}{${d.email}}
\\quad | \\quad
\\faGithub\\ \\href{${d.github}}{${d.github_display || 'GitHub'}}
\\quad | \\quad
\\faGlobe\\ \\href{${d.portfolio}}{${d.portfolio_display || 'Portfolio'}}

\\end{center}

\\vspace{-3pt}
`;
}

function summaryBlock(d) {
  if (!d.summary) return '';
  return `\n\\section{Summary}\n\\vspace{2pt}\n\\small ${d.summary}\n`;
}

function eduBlock(list) {
  let s = `\n\\section{Education}\n`;
  for (const e of list) {
    s += `\n\\resumeSubheading\n{${e.institute}}\n{${e.duration}}\n{${e.degree}}\n{${e.location}}\n`;
    if (e.details && e.details.length) {
      s += `\\resumeItemListStart\n` + e.details.map(d => `\\resumeItem{\n${d}\n}`).join('\n') + `\n\\resumeItemListEnd\n`;
    }
  }
  return s;
}

function expBlock(list) {
  let s = `\n\\section{Experience}\n`;
  for (const e of list) {
    s += `\n\\resumeSubheading\n{${e.company}}\n{${e.duration}}\n{${e.role}}\n{${e.location}}\n`;
    s += `\\resumeItemListStart\n` + (e.points || []).map(p => `\\resumeItem{\n${p}\n}`).join('\n') + `\n\\resumeItemListEnd\n`;
  }
  return s;
}

function projBlock(list) {
  let s = `\n\\section{Projects}\n\n\\vspace{-4pt}\n`;
  for (const p of list) {
    s += `\n\\resumeProject\n{${p.title}}\n{${p.tech_stack}}\n{${p.repo_link}}\n`;
    s += `\\resumeItemListStart\n` + (p.points || []).map(pt => `\\resumeItem{\n${pt}\n}`).join('\n') + `\n\\resumeItemListEnd\n`;
  }
  return s;
}

function skillsBlock(list) {
  let s = `\n\\section{Technical Skills}\n\n\\small\n`;
  s += list.map((c, i) => `${i ? '\\vspace{2pt}\n\n' : ''}\\textbf{${c.category}:}\n${c.items}\n`).join('\n');
  return s;
}

function achBlock(list) {
  return `\n\\section{Achievements}\n\n\\begin{itemize}[leftmargin=0.18in,itemsep=2pt]\n` +
    list.map(a => `\\item ${a}`).join('\n') + `\n\\end{itemize}\n`;
}

const PREAMBLE = `\\documentclass[a4paper,10pt]{article}
\\usepackage[left=0.25in,right=0.25in,top=0.35in,bottom=0.35in]{geometry}
\\usepackage{titlesec}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fontawesome5}
\\usepackage{tabularx}
\\usepackage[default]{lato}
\\usepackage{xcolor}
\\pagestyle{empty}
\\setlength{\\tabcolsep}{0pt}
\\setlength{\\parindent}{0pt}
\\raggedright
\\titleformat{\\section}{\\large\\scshape}{}{0em}{}[\\titlerule]
\\titlespacing*{\\section}{0pt}{8pt}{5pt}
\\newcommand{\\resumeItem}[1]{\\item\\small{#1}}
\\newcommand{\\resumeSubheading}[4]{\\begin{tabular*}{\\textwidth}{l@{\\extracolsep{\\fill}}r}{\\Large\\textbf{#1}} & #2 \\\\ \\textit{#3} & \\textit{#4}\\end{tabular*}\\vspace{2pt}}
\\newcommand{\\resumeProject}[3]{\\vspace{6pt}\\underline{\\textbf{\\normalsize #1}} \\textbar\\ \\small #2 \\textbar\\ \\href{#3}{\\underline{GitHub}}\\vspace{1pt}}
\\newcommand{\\resumeItemListStart}{\\begin{itemize}[leftmargin=0.18in,itemsep=1pt,topsep=1pt]}
\\newcommand{\\resumeItemListEnd}{\\end{itemize}\\vspace{1pt}}
`;

function buildTex(d) {
  return `${PREAMBLE}
\\begin{document}
${headerBlock(d)}${eduBlock(d.education || [])}${expBlock(d.experience || [])}${projBlock(d.projects || [])}${skillsBlock(d.skills || [])}${achBlock(d.achievements || [])}
\\end{document}
`;
}

// ── compiler detection ───────────────────────────────────────────────
function exists(cmd, args = ['--version']) {
  try { const r = spawnSync(cmd, args, { stdio: 'ignore' }); return r.status === 0 || r.status === null ? !r.error : !r.error; }
  catch { return false; }
}
function findCompiler() {
  if (process.env.LATEX_COMPILER) return { cmd: process.env.LATEX_COMPILER, kind: 'tex' };
  for (const c of ['pdflatex', 'xelatex', 'lualatex']) if (exists(c)) return { cmd: c, kind: 'tex' };
  if (exists('latexmk')) return { cmd: 'latexmk', kind: 'latexmk' };
  // user-local installs
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const localApp = process.env.LOCALAPPDATA || '';
  const candidates = [
    path.join(process.env.APPDATA || '', 'TinyTeX', 'bin', 'windows', 'pdflatex.exe'),
    path.join(localApp, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'pdflatex.exe'),
    path.join(home, 'AppData', 'Roaming', 'TinyTeX', 'bin', 'windows', 'pdflatex.exe'),
  ];
  for (const c of candidates) if (c && existsSync(c)) return { cmd: c, kind: 'tex' };
  const tectonic = path.join(REPO_ROOT, 'tools', 'tectonic.exe');
  if (existsSync(tectonic)) return { cmd: tectonic, kind: 'tectonic' };
  if (exists('tectonic')) return { cmd: 'tectonic', kind: 'tectonic' };
  return null;
}

function compile(texPath, outPdf, comp) {
  mkdirSync(BUILD_DIR, { recursive: true });
  let args;
  if (comp.kind === 'latexmk') args = ['-pdf', '-interaction=nonstopmode', `-outdir=${BUILD_DIR}`, texPath];
  else if (comp.kind === 'tectonic') args = [texPath, '--outdir', BUILD_DIR];
  else args = ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', BUILD_DIR, texPath];
  const r = spawnSync(comp.cmd, args, { encoding: 'utf-8' });
  const built = path.join(BUILD_DIR, path.basename(texPath).replace(/\.tex$/, '.pdf'));
  if (!existsSync(built)) {
    const log = (r.stdout || '') + (r.stderr || '');
    const tail = log.split('\n').slice(-25).join('\n');
    throw new Error(`compile failed with ${comp.cmd}.\n--- log tail ---\n${tail}`);
  }
  mkdirSync(OUTPUT_DIR, { recursive: true });
  renameSync(built, outPdf);
}

// ── main ─────────────────────────────────────────────────────────────
let data = JSON.parse(readFileSync(BASE_JSON, 'utf-8'));
if (jobFile) {
  const over = JSON.parse(readFileSync(path.resolve(jobFile), 'utf-8'));
  data = deepMerge(data, over);
  if (!nameSlug) nameSlug = path.basename(jobFile).replace(/\.json$/, '');
}
if (!nameSlug) nameSlug = 'base';

mkdirSync(BUILD_DIR, { recursive: true });
const texPath = path.join(BUILD_DIR, `cv-${nameSlug}.tex`);
writeFileSync(texPath, buildTex(data), 'utf-8');
console.log(`📝 wrote ${path.relative(REPO_ROOT, texPath)}`);

const comp = findCompiler();
if (!comp) {
  console.error('\n⚠️  No LaTeX compiler found (pdflatex/xelatex/latexmk/tectonic).');
  console.error('   The .tex was generated above — install a TeX distro (TinyTeX gives pdflatex) to compile,');
  console.error('   or compile the .tex in CI / Overleaf. Set LATEX_COMPILER to override detection.');
  process.exit(2);
}
console.log(`🔧 compiler: ${comp.cmd} (${comp.kind})`);

const dateStr = new Date().toISOString().slice(0, 10);
const slugName = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outPdf = arg('--out') || path.join(OUTPUT_DIR, `cv-${slugName}-${nameSlug}-${dateStr}.pdf`);
compile(texPath, outPdf, comp);
console.log(`✅ PDF: ${path.relative(REPO_ROOT, outPdf)}`);
