/**
 * lc/llm.mjs — shared LangChain.js + Google Gemini plumbing for career-ops-3.0.
 *
 * The coded LLM layer (CareerOS pattern, ported to LangChain.js):
 *   PromptTemplate | Gemini chat model | JSON validator(zod)
 *
 * Provider: Google Gemini (free tier, reuses the GEMINI_API_KEY that 2.0's
 * gemini-eval.mjs already uses). Models are chosen per task via .env:
 *   - GEMINI_RATING_MODEL (default gemini-2.5-flash)  — fast scoring
 *   - GEMINI_RESUME_MODEL (default gemini-2.5-flash)  — resume writing
 *
 * Note: HuggingFace remains an option for later — see git history for the HF
 * variant — but its free Inference Providers credits were depleted, so Gemini
 * is the default working backend.
 */

import 'dotenv/config';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatOllama } from '@langchain/ollama';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableLambda } from '@langchain/core/runnables';

// Provider: 'ollama' (local, free, unlimited — default) or 'gemini' (cloud).
const PROVIDER = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();

const MODELS = {
  gemini: {
    rating: process.env.GEMINI_RATING_MODEL || 'gemini-2.5-flash',
    resume: process.env.GEMINI_RESUME_MODEL || 'gemini-2.5-flash',
  },
  ollama: {
    rating: process.env.OLLAMA_RATING_MODEL || 'llama3.1',
    resume: process.env.OLLAMA_RESUME_MODEL || 'llama3.1',
  },
};

export function assertKey() {
  if (PROVIDER === 'gemini' && !process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is required for LLM_PROVIDER=gemini. Get a free key at ' +
        'https://aistudio.google.com/apikey and add it to .env'
    );
  }
}

/**
 * Build a chat model for a given task kind, per the active provider.
 * @param {'rating'|'resume'} kind
 * @param {{temperature?: number, maxTokens?: number}} [opts]
 */
export function makeLLM(kind, opts = {}) {
  assertKey();
  const temperature = opts.temperature ?? (kind === 'resume' ? 0.5 : 0.3);

  if (PROVIDER === 'gemini') {
    // gemini-2.5-flash is a "thinking" model that spends output tokens on
    // internal reasoning, so give a generous budget or the JSON truncates.
    return new ChatGoogleGenerativeAI({
      model: MODELS.gemini[kind] || MODELS.gemini.rating,
      apiKey: process.env.GEMINI_API_KEY,
      temperature,
      maxOutputTokens: opts.maxTokens ?? 8192,
    });
  }

  // Ollama (default). `format: 'json'` makes the local model emit valid JSON.
  return new ChatOllama({
    model: MODELS.ollama[kind] || MODELS.ollama.rating,
    baseUrl: process.env.OLLAMA_HOST || 'http://localhost:11434',
    temperature,
    format: 'json',
    numPredict: opts.maxTokens ?? 8192,
  });
}

/**
 * Pull the first balanced JSON object/array out of a model's raw text.
 * Resilient to prose wrappers and ```json fences.
 */
export function extractJson(text) {
  if (typeof text !== 'string') return text;
  let s = text.trim();
  s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = s.search(/[{[]/);
  if (start === -1) throw new Error(`No JSON found in model output:\n${text.slice(0, 400)}`);
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(s.slice(start, i + 1));
    }
  }
  throw new Error(`Unbalanced JSON in model output:\n${text.slice(0, 400)}`);
}

// Chat models emit an AIMessage; normalize to the string content.
const toText = RunnableLambda.from((msg) =>
  typeof msg === 'string' ? msg : Array.isArray(msg?.content)
    ? msg.content.map((p) => (typeof p === 'string' ? p : p.text || '')).join('')
    : String(msg?.content ?? msg)
);

/**
 * Build a LangChain chain: PromptTemplate -> Gemini -> JSON(zod-validated).
 *
 * @param {object} cfg
 * @param {string}   cfg.template        PromptTemplate string ({var} placeholders).
 * @param {string[]} cfg.inputVariables  Template variable names.
 * @param {import('zod').ZodTypeAny} cfg.schema  Zod schema to validate output.
 * @param {'rating'|'resume'} cfg.kind   Which model to use.
 * @param {object} [cfg.modelOpts]
 * @returns Runnable; `.invoke(vars)` -> parsed, validated object.
 */
export function buildJsonChain({ template, inputVariables, schema, kind, modelOpts }) {
  const prompt = new PromptTemplate({ template, inputVariables });
  const llm = makeLLM(kind, modelOpts);

  const parse = RunnableLambda.from((raw) => {
    const obj = extractJson(raw);
    const result = schema.safeParse(obj);
    if (!result.success) {
      throw new Error(
        'Model output failed schema validation:\n' +
          JSON.stringify(result.error.issues, null, 2) +
          '\n\nRaw object:\n' +
          JSON.stringify(obj, null, 2).slice(0, 800)
      );
    }
    return result.data;
  });

  return prompt.pipe(llm).pipe(toText).pipe(parse);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Invoke a chain with exponential backoff. Handles both malformed-JSON retries
 * and transient API errors (429 rate limits, 5xx, network blips on the free
 * tier) — backs off 1.5s, 3s, 6s, 12s between attempts.
 */
export async function invokeWithRetry(chain, vars, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await chain.invoke(vars);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export { MODELS };
