/**
 * lc/schemas.mjs — zod schemas shared across the LangChain stages.
 * These both validate model output and document the data contract.
 */
import { z } from 'zod';

// ── Resume (parsed + generated) ──────────────────────────────────────────────
// Mirrors resume-engine/base_resume.json. Parsed resumes hold plain text;
// generated (tailored) resumes hold LaTeX-safe strings for render.mjs.
export const EducationSchema = z.object({
  institute: z.string(),
  degree: z.string(),
  duration: z.string().default(''),
  location: z.string().default(''),
  details: z.array(z.string()).default([]),
});

export const ExperienceSchema = z.object({
  role: z.string(),
  company: z.string(),
  duration: z.string().default(''),
  location: z.string().default(''),
  points: z.array(z.string()).default([]),
});

export const ProjectSchema = z.object({
  title: z.string(),
  tech_stack: z.string().default(''),
  repo_link: z.string().optional().default(''),
  points: z.array(z.string()).default([]),
});

export const SkillSchema = z.object({
  category: z.string(),
  items: z.string(),
});

export const ResumeSchema = z.object({
  name: z.string(),
  phone: z.string().default(''),
  email: z.string().default(''),
  github: z.string().default(''),
  github_display: z.string().default('GitHub'),
  portfolio: z.string().default(''),
  portfolio_display: z.string().default('Portfolio'),
  education: z.array(EducationSchema).default([]),
  experience: z.array(ExperienceSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  achievements: z.array(z.string()).default([]),
});

// ── Job rating (out of 5) ─────────────────────────────────────────────────────
export const RatingSchema = z.object({
  score: z.number().min(0).max(5),
  verdict: z.enum(['strong', 'good', 'stretch', 'weak']).default('good'),
  matched: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  reason: z.string().default(''),
});

// ── GitHub project catalog entry ──────────────────────────────────────────────
export const CatalogProjectSchema = z.object({
  repo: z.string(),
  name: z.string(),
  tech_stack: z.string().default(''),
  one_liner: z.string().default(''),
  bullets: z.array(z.string()).default([]),
  domains: z.array(z.string()).default([]), // e.g. ["gen-ai","data-eng","mern"]
  tier: z.enum(['flagship', 'solid', 'minor']).default('solid'),
  repo_link: z.string().default(''),
});

export const CatalogSchema = z.object({
  projects: z.array(CatalogProjectSchema),
});
