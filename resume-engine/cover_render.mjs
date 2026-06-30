#!/usr/bin/env node
/**
 * cover_render.mjs — cover letter -> LaTeX (matches the resume's header/font) -> PDF.
 * Reuses base_resume.json for the header (name/contact) and a cover-letters/*.json for the body.
 *
 *   node resume-engine/cover_render.mjs --letter resume-engine/cover-letters/versatile.json --name versatile
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BASE = JSON.parse(readFileSync(path.join(__dirname, 'base_resume.json'), 'utf-8'));
const BUILD = path.join(__dirname, 'build');
const OUT = path.join(REPO_ROOT, 'output');

const arg = (f) => { const i = process.argv.indexOf(f); return i !== -1 ? process.argv[i + 1] : null; };
const letterFile = arg('--letter') || path.join(__dirname, 'cover-letters', 'versatile.json');
const nameSlug = arg('--name') || path.basename(letterFile).replace(/\.json$/, '');
const L = JSON.parse(readFileSync(path.resolve(letterFile), 'utf-8'));

const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

const PREAMBLE = `\\documentclass[a4paper,11pt]{article}
\\usepackage[left=0.9in,right=0.9in,top=0.7in,bottom=0.7in]{geometry}
\\usepackage[hidelinks]{hyperref}
\\usepackage{fontawesome5}
\\usepackage[default]{lato}
\\usepackage{parskip}
\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
`;

function header(d) {
  return `\\begin{center}
{\\LARGE\\textbf{${d.name}}}\\\\[4pt]
\\rule{\\linewidth}{1.2pt}\\\\[3pt]
\\small \\faPhone\\ ${d.phone} \\quad|\\quad \\faEnvelope\\ \\href{mailto:${d.email}}{${d.email}} \\quad|\\quad \\faGithub\\ \\href{${d.github}}{${d.github_display || 'GitHub'}} \\quad|\\quad \\faGlobe\\ \\href{${d.portfolio}}{${d.portfolio_display || 'Portfolio'}}
\\end{center}
\\vspace{6pt}
`;
}

const body = `${PREAMBLE}\\begin{document}
${header(BASE)}
${today}

\\vspace{8pt}
${L.salutation}

${L.paragraphs.map(p => p).join('\n\n')}

\\vspace{10pt}
${L.closing}\\\\[2pt]
\\textbf{${BASE.name}}
\\end{document}
`;

mkdirSync(BUILD, { recursive: true });
const tex = path.join(BUILD, `cover-${nameSlug}.tex`);
writeFileSync(tex, body, 'utf-8');
console.log(`📝 wrote ${path.relative(REPO_ROOT, tex)}`);

// compiler detection (same as render.mjs)
function exists(c) { try { const r = spawnSync(c, ['--version'], { stdio: 'ignore' }); return !r.error; } catch { return false; } }
let cmd = process.env.LATEX_COMPILER;
if (!cmd) {
  for (const c of ['pdflatex', 'xelatex', 'lualatex']) if (exists(c)) { cmd = c; break; }
}
if (!cmd) {
  const cand = path.join(process.env.APPDATA || '', 'TinyTeX', 'bin', 'windows', 'pdflatex.exe');
  if (existsSync(cand)) cmd = cand;
}
if (!cmd) { console.error('No LaTeX compiler found.'); process.exit(2); }

const r = spawnSync(cmd, ['-interaction=nonstopmode', '-halt-on-error', '-output-directory', BUILD, tex], { encoding: 'utf-8' });
const built = path.join(BUILD, `cover-${nameSlug}.pdf`);
if (!existsSync(built)) { console.error((r.stdout || '').split('\n').slice(-20).join('\n')); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const slug = BASE.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const outPdf = path.join(OUT, `cover-letter-${slug}-${nameSlug}.pdf`);
renameSync(built, outPdf);
console.log(`✅ PDF: ${path.relative(REPO_ROOT, outPdf)}`);
