// Length and token pre-checks, run before any request leaves the extension.

import { MODELS, REASONING_LEVELS } from './models.js';

export const MAX_CHARS = 100_000;
export const MIN_CHARS = 500;
export const PROMPT_OVERHEAD_TOKENS = 2_000;
export const CONTEXT_SAFETY = 0.9;

// Latin script averages about 4 characters per token; Indic and other
// scripts tokenize more densely, so they are counted conservatively.
export function estimateTokens(text) {
  let latin = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.codePointAt(0) <= 0x024f) latin++;
    else other++;
  }
  return Math.ceil(latin / 4 + other / 1.5);
}

export function tokenRoom(model, reasoning) {
  return (
    Math.floor(MODELS[model].contextTokens * CONTEXT_SAFETY) -
    PROMPT_OVERHEAD_TOKENS -
    REASONING_LEVELS[reasoning].maxTokens
  );
}

export function checkBudget(text, { model, reasoning }) {
  const chars = text.length;
  if (chars < MIN_CHARS) return { ok: false, code: 'no_terms', chars };
  if (chars > MAX_CHARS) return { ok: false, code: 'too_long', chars, limit: MAX_CHARS };
  const tokens = estimateTokens(text);
  const limit = tokenRoom(model, reasoning);
  if (tokens > limit) return { ok: false, code: 'too_many_tokens', chars, tokens, limit };
  return { ok: true, chars, tokens };
}

export function budgetMessage(result, { model }) {
  const n = (x) => x.toLocaleString('en-US');
  switch (result.code) {
    case 'no_terms':
      return `Couldn't find the terms on this page. Only ${n(result.chars)} characters of readable text were found.`;
    case 'too_long':
      return `This document is too long to analyze (${n(result.chars)} characters, limit ${n(result.limit)}).`;
    case 'too_many_tokens':
      return `This document is too long for ${model} at this reasoning level (about ${n(result.tokens)} tokens, room for ${n(result.limit)}). Try a lower reasoning level or a larger model.`;
    default:
      return 'This document cannot be analyzed.';
  }
}
