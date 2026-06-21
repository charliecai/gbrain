/**
 * Multi-Query Expansion — v0.14+ delegates LLM call to the AI gateway.
 *
 * Sanitization layer (prompt-injection defense) stays HERE, not in the gateway:
 * the gateway is provider-agnostic; sanitization is gbrain's responsibility.
 *
 * Security (Fix 3 / M1 / M2 / M3):
 *   - sanitizeQueryForPrompt() strips injection patterns from user input
 *   - sanitizeExpansionOutput() validates LLM output before it reaches search
 *   - console.warn never logs the query text itself (privacy)
 */

import { expand as gatewayExpand, isAvailable as gatewayIsAvailable } from '../ai/gateway.ts';
import { countCJKAwareWords } from '../cjk.ts';

const MAX_QUERIES = 3;
const MIN_WORDS = 3;
const MAX_QUERY_CHARS = 500;

export interface QueryExpansionConfig {
  provider: 'anthropic' | 'openai_compatible';
  model: string;
  apiKey?: string;
  baseURL?: string;
}

/**
 * Back-compat shim for pre-gateway query expansion config.
 *
 * New runtime expansion delegates to the AI gateway (`provider:model` recipes),
 * but this keeps older local scripts/tests able to resolve the legacy
 * GBRAIN_QUERY_EXPANSION_* environment contract.
 */
export function queryExpansionConfigFromEnv(env: NodeJS.ProcessEnv = process.env): QueryExpansionConfig {
  const model = env.GBRAIN_QUERY_EXPANSION_MODEL || env.GBRAIN_EXPANSION_MODEL;
  const baseURL = env.GBRAIN_QUERY_EXPANSION_BASE_URL || env.GBRAIN_EXPANSION_BASE_URL;
  const apiKey = env.GBRAIN_QUERY_EXPANSION_API_KEY
    || env.GBRAIN_EXPANSION_API_KEY
    || env.DEEPSEEK_API_KEY
    || env.OPENAI_API_KEY;

  if (model || baseURL || env.GBRAIN_QUERY_EXPANSION_PROVIDER === 'openai_compatible') {
    return {
      provider: 'openai_compatible',
      model: model || 'deepseek-v4-flash',
      apiKey,
      baseURL: baseURL || 'https://api.deepseek.com',
    };
  }

  return {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    apiKey: env.ANTHROPIC_API_KEY,
  };
}

/**
 * Defense-in-depth sanitization for user queries before they reach the LLM.
 */
export function sanitizeQueryForPrompt(query: string): string {
  const original = query;
  let q = query;
  if (q.length > MAX_QUERY_CHARS) q = q.slice(0, MAX_QUERY_CHARS);
  q = q.replace(/```[\s\S]*?```/g, ' ');
  q = q.replace(/<\/?[a-zA-Z][^>]*>/g, ' ');
  q = q.replace(/^(\s*(ignore|forget|disregard|override|system|assistant|human)[\s:]+)+/gi, '');
  q = q.replace(/\s+/g, ' ').trim();
  if (q !== original) {
    console.warn('[gbrain] sanitizeQueryForPrompt: stripped content from user query before LLM expansion');
  }
  return q;
}

/**
 * Validate LLM-produced alternative queries. LLM output is untrusted.
 */
export function sanitizeExpansionOutput(alternatives: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of alternatives) {
    if (typeof raw !== 'string') continue;
    let s = raw.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (s.length === 0) continue;
    if (s.length > MAX_QUERY_CHARS) s = s.slice(0, MAX_QUERY_CHARS);
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= 2) break;
  }
  return out;
}

export function parseExpansionJson(content: string): { alternative_queries?: unknown } | null {
  try {
    return JSON.parse(content) as { alternative_queries?: unknown };
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as { alternative_queries?: unknown };
    } catch {
      return null;
    }
  }
}

export async function expandQuery(query: string): Promise<string[]> {
  if (countCJKAwareWords(query) < MIN_WORDS) return [query];

  // Skip LLM call entirely if gateway has no expansion provider configured.
  if (!gatewayIsAvailable('expansion')) return [query];

  try {
    const sanitized = sanitizeQueryForPrompt(query);
    if (sanitized.length === 0) return [query];

    // gateway.expand() returns [original + expansions]. We feed it the sanitized
    // copy so the LLM channel is safe; the ORIGINAL query remains the first entry
    // for downstream search (gateway.expand includes the query it was called with).
    const gatewayResults = await gatewayExpand(sanitized);

    // Validate LLM-produced alternatives (everything after the first entry).
    const alternatives = gatewayResults.slice(1);
    const sanitizedAlts = sanitizeExpansionOutput(alternatives);

    // Original query + sanitized alternatives, deduped, capped at MAX_QUERIES.
    const all = [query, ...sanitizedAlts];
    const unique = [...new Set(all.map(q => q.toLowerCase().trim()))];
    return unique.slice(0, MAX_QUERIES).map(q =>
      all.find(orig => orig.toLowerCase().trim() === q) || q,
    );
  } catch {
    return [query];
  }
}
