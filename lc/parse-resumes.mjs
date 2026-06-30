#!/usr/bin/env node
/**
 * lc/parse-resumes.mjs — turn your raw resumes into structured JSON.
 *
 * Reads every resume in resume-engine/resumes/ (*.pdf, *.txt, *.md), extracts
 * the text, and uses a LangChain chain (HF resume model) to structure each into
 * the canonical resume schema (resume-engine/resumes/parsed/<name>.json).
 *
 * These parsed resumes are the rating set (lc/rate-jobs.mjs) and the tailoring
 * bases (lc/gen-resume.mjs).
 *
 * Usage:
 *   node lc/parse-resumes.mjs                 # parse all -> parsed/*.json
 *   node lc/parse-resumes.mjs --extract-only  # just dump extracted text (no LLM, no token)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildJsonChain, invokeWithRetry } from './llm.mjs';
import { ResumeSchema } from './schemas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESUMES_DIR = path.join(HERE, '..', 'resume-engine', 'resumes');
const PARSED_DIR = path.join(RESUMES_DIR, 'parsed');

async function extractText(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.pdf') {
    // import the lib file directly to avoid pdf-parse's debug-mode test read
    const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const data = await pdfParse(readFileSync(file));
    return data.text;
  }
  return readFileSync(file, 'utf-8');
}

const PROMPT = `You are a precise resume parser. Convert the RESUME TEXT below into a JSON object.

Output ONLY valid JSON (no prose, no markdown fences) with EXACTLY these fields:
{{
  "name": string,
  "phone": string,
  "email": string,
  "github": string,           // full URL if present, else ""
  "github_display": "GitHub",
  "portfolio": string,        // full URL if present, else ""
  "portfolio_display": "Portfolio",
  "education": [{{ "institute": string, "degree": string, "duration": string, "location": string, "details": [string] }}],
  "experience": [{{ "role": string, "company": string, "duration": string, "location": string, "points": [string] }}],
  "projects": [{{ "title": string, "tech_stack": string, "repo_link": string, "points": [string] }}],
  "skills": [{{ "category": string, "items": string }}],
  "achievements": [string]
}}

RULES:
- Use PLAIN TEXT for all values (no LaTeX, no markdown). Do not escape characters.
- Copy real content faithfully. NEVER invent experience, skills, projects, or metrics that are not in the text.
- Keep every bullet point. Split combined bullets into separate array items.
- "skills" must be grouped into sensible categories (e.g. "Languages", "Data Engineering", "Gen AI", "ML/DL").
- If a field is absent, use "" (strings) or [] (arrays).

RESUME TEXT:
{resume_text}`;

async function main() {
  const extractOnly = process.argv.includes('--extract-only');

  if (!existsSync(RESUMES_DIR)) {
    console.error(`No resumes dir at ${RESUMES_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(RESUMES_DIR).filter(
    (f) => /\.(pdf|txt|md)$/i.test(f) && f.toLowerCase() !== 'readme.md'
  );
  if (files.length === 0) {
    console.error('No resume files (*.pdf/*.txt/*.md) found in resume-engine/resumes/');
    process.exit(1);
  }
  console.log(`Found ${files.length} resume(s): ${files.join(', ')}\n`);

  let chain;
  if (!extractOnly) chain = buildJsonChain({
    template: PROMPT,
    inputVariables: ['resume_text'],
    schema: ResumeSchema,
    kind: 'resume',
  });

  mkdirSync(PARSED_DIR, { recursive: true });
  const index = [];

  for (const file of files) {
    const full = path.join(RESUMES_DIR, file);
    const base = path.basename(file, path.extname(file));
    process.stdout.write(`• ${file} — extracting text... `);
    const text = (await extractText(full)).replace(/\r/g, '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    console.log(`${text.length} chars`);

    if (extractOnly) {
      const txtOut = path.join(PARSED_DIR, `${base}.extracted.txt`);
      writeFileSync(txtOut, text, 'utf-8');
      console.log(`   → ${path.relative(process.cwd(), txtOut)}`);
      continue;
    }

    process.stdout.write('   structuring with LLM... ');
    const parsed = await invokeWithRetry(chain, { resume_text: text });
    const outPath = path.join(PARSED_DIR, `${base}.json`);
    writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf-8');
    console.log('done');
    console.log(`   → ${path.relative(process.cwd(), outPath)}  (${parsed.projects?.length || 0} projects, ${parsed.skills?.length || 0} skill groups)`);
    index.push({ id: base, file: `${base}.json`, name: parsed.name });
  }

  if (!extractOnly) {
    writeFileSync(path.join(PARSED_DIR, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
    console.log(`\n✅ Parsed ${index.length} resume(s) → resume-engine/resumes/parsed/`);
  }
}

main().catch((e) => {
  console.error('\n❌ parse-resumes failed:', e.message);
  process.exit(1);
});
