// Model and reasoning tables. Everything that depends on a model ID or a
// reasoning level reads from here, so a new model only needs a row.

export const SARVAM_CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';
export const SARVAM_ORIGIN = 'https://api.sarvam.ai/*';

export const MODELS = {
  'sarvam-105b': { label: 'Sarvam 105B (128K context)', contextTokens: 128_000 },
  'sarvam-30b': { label: 'Sarvam 30B (64K context)', contextTokens: 64_000 },
};

export const DEFAULT_MODEL = 'sarvam-105b';

// `effort: null` is sent explicitly: Sarvam turns reasoning on when the field is omitted.
// Reasoning tokens count against max_tokens, so higher levels get a larger budget.
export const REASONING_LEVELS = {
  off: { label: 'Off', effort: null, maxTokens: 4096 },
  low: { label: 'Low', effort: 'low', maxTokens: 8192 },
  medium: { label: 'Medium', effort: 'medium', maxTokens: 12288 },
  high: { label: 'High', effort: 'high', maxTokens: 16384 },
};

export const REASONING_ORDER = ['off', 'low', 'medium', 'high'];
export const DEFAULT_REASONING = 'low';

export function lowerReasoning(level) {
  const i = REASONING_ORDER.indexOf(level);
  return i > 0 ? REASONING_ORDER[i - 1] : null;
}
