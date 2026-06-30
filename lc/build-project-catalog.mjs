#!/usr/bin/env node
/**
 * lc/build-project-catalog.mjs — build a catalog of your GitHub projects.
 *
 * For each repo: fetch metadata + README from the GitHub API, then (with the
 * LLM) distill it into resume-ready "pointers":
 *   { repo, name, tech_stack, one_liner, bullets[], domains[], tier, repo_link }
 *
 * The resume generator (lc/gen-resume.mjs) picks the most relevant projects
 * from this catalog per job description.
 *
 * Output: config/project-catalog.json
 *
 * Usage:
 *   node lc/build-project-catalog.mjs            # fetch + LLM-distill (needs HF token)
 *   node lc/build-project-catalog.mjs --no-llm   # fetch only -> raw metadata catalog (no token)
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildJsonChain, invokeWithRetry } from './llm.mjs';
import { CatalogProjectSchema } from './schemas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'config', 'project-catalog.json');
const OWNER = 'gorredinesh21';

// All 23 repos, with a tier hint so the generator can favour the strong ones.
const REPOS = [
  { repo: 'FinNest', tier: 'flagship' },
  { repo: 'CricKart', tier: 'flagship' },
  { repo: 'PORTFOLIO', tier: 'solid' },
  { repo: 'Startup-Intelligence-Platform', tier: 'flagship' },
  { repo: 'Career-ops-2.0', tier: 'flagship' },
  { repo: 'TINDER_MCP_AI', tier: 'flagship' },
  { repo: 'JOB_APPLICATION_HANDLER-', tier: 'flagship' },
  { repo: 'FINAL_YEAR_PROJECT', tier: 'flagship' },
  { repo: 'CREDIT_CARD_FRAUD_DETECTION', tier: 'solid' },
  { repo: 'BLOCKCHAIN', tier: 'solid' },
  { repo: 'GAN-BASED-TABULAR-DATA-AUGMENTATION-', tier: 'flagship' },
  { repo: 'BANGLORE_HOUSE_PRICE_PREDICTOR', tier: 'minor' },
  { repo: 'ImageEntityExtraction', tier: 'solid' },
  { repo: 'MARS_LANDMARK_DETECTION', tier: 'solid' },
  { repo: 'MOVIE_RECOMENDATION_SYSTEM', tier: 'minor' },
  { repo: 'SINGAPORE_HOUSE_PRICE_PREDICTOR', tier: 'minor' },
  { repo: 'claude_streamlit', tier: 'minor' },
  { repo: 'flask_deployment', tier: 'minor' },
  { repo: 'The-Bit-Lords---IIT-ISM-Dhanbhad', tier: 'minor' },
  { repo: 'OS-PROJECRT', tier: 'minor' },
  { repo: 'bank-managment-system', tier: 'minor' },
  { repo: 'flappy-bird-game', tier: 'minor' },
  { repo: 'snake-game-', tier: 'minor' },
];

const GH_HEADERS = { 'User-Agent': 'career-ops-3.0', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) GH_HEADERS.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function ghJson(url) {
  const res = await fetch(url, { headers: GH_HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${url}`);
  return res.json();
}

async function fetchRepo(repo) {
  const meta = await ghJson(`https://api.github.com/repos/${OWNER}/${repo}`);
  let readme = '';
  const r = await ghJson(`https://api.github.com/repos/${OWNER}/${repo}/readme`);
  if (r?.content) readme = Buffer.from(r.content, r.encoding || 'base64').toString('utf-8');
  return {
    repo,
    repo_link: `https://github.com/${OWNER}/${repo}`,
    description: meta?.description || '',
    language: meta?.language || '',
    topics: meta?.topics || [],
    stars: meta?.stargazers_count ?? 0,
    pushed_at: meta?.pushed_at || '',
    readme: readme.slice(0, 6000), // cap context
  };
}

const PROMPT = `You are writing resume project entries for a software/AI engineer.
Given a GitHub repository's metadata and README, produce ONE JSON object:

{{
  "repo": "{repo}",
  "name": string,             // clean human project name (not the repo slug)
  "tech_stack": string,       // comma-separated key technologies actually used
  "one_liner": string,        // 1 sentence: what it does + impact
  "bullets": [string],        // 2-4 crisp resume bullets, each starting with a strong verb, quantified where the README gives numbers
  "domains": [string],        // tags from: gen-ai, ml, dl, data-eng, mern, fullstack, backend, frontend, devops, blockchain, cv, nlp, mlops
  "tier": "{tier}",
  "repo_link": "{repo_link}"
}}

RULES:
- PLAIN TEXT values (no markdown/LaTeX).
- Only claim what the README/metadata support. NEVER invent metrics or tech.
- Bullets must be specific and achievement-oriented, not generic.

REPO METADATA:
- description: {description}
- primary language: {language}
- topics: {topics}

README (truncated):
{readme}`;

async function main() {
  const noLlm = process.argv.includes('--no-llm');
  console.log(`Fetching ${REPOS.length} repos from GitHub (${OWNER})...\n`);

  const fetched = [];
  for (const { repo } of REPOS) {
    process.stdout.write(`• ${repo} ... `);
    try {
      const data = await fetchRepo(repo);
      fetched.push(data);
      console.log(`ok (${data.language || '—'}, ${data.readme.length} README chars)`);
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
  }

  mkdirSync(path.dirname(OUT), { recursive: true });

  if (noLlm) {
    const projects = fetched.map((f, i) => ({
      repo: f.repo,
      name: f.repo.replace(/[-_]+/g, ' ').replace(/\s+$/, '').trim(),
      tech_stack: f.language,
      one_liner: f.description,
      bullets: [],
      domains: f.topics,
      tier: REPOS[i].tier,
      repo_link: f.repo_link,
    }));
    writeFileSync(OUT, JSON.stringify({ projects }, null, 2), 'utf-8');
    console.log(`\n[no-llm] wrote raw catalog → config/project-catalog.json (${projects.length} projects)`);
    return;
  }

  const chain = buildJsonChain({
    template: PROMPT,
    inputVariables: ['repo', 'tier', 'repo_link', 'description', 'language', 'topics', 'readme'],
    schema: CatalogProjectSchema,
    kind: 'resume',
  });

  const projects = [];
  for (let i = 0; i < fetched.length; i++) {
    const f = fetched[i];
    process.stdout.write(`  distilling ${f.repo} ... `);
    try {
      const proj = await invokeWithRetry(chain, {
        repo: f.repo,
        tier: REPOS[i].tier,
        repo_link: f.repo_link,
        description: f.description || '(none)',
        language: f.language || '(unknown)',
        topics: (f.topics || []).join(', ') || '(none)',
        readme: f.readme || '(no README)',
      });
      projects.push(proj);
      console.log(`ok (${proj.bullets.length} bullets)`);
    } catch (e) {
      console.log(`skipped: ${e.message}`);
    }
  }

  writeFileSync(OUT, JSON.stringify({ projects }, null, 2), 'utf-8');
  console.log(`\n✅ wrote ${projects.length} projects → config/project-catalog.json`);
}

main().catch((e) => {
  console.error('\n❌ build-project-catalog failed:', e.message);
  process.exit(1);
});
