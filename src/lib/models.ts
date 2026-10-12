// Model and reasoning tables. Everything that depends on a model ID or a
// reasoning level reads from here, so a new model only needs a row.

export const SARVAM_CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';
export const SARVAM_ORIGIN = 'https://api.sarvam.ai/*';

export interface ModelInfo {
  label: string;
  contextTokens: number;
}

export const MODELS: Record<ModelId, ModelInfo> = {
  'sarvam-105b': { label: 'Sarvam 105B (128K context)', contextTokens: 128_000 },
  'sarvam-30b': { label: 'Sarvam 30B (64K context)', contextTokens: 64_000 },
};

export const DEFAULT_MODEL: ModelId = 'sarvam-105b';

export interface ReasoningInfo {
  label: string;
  effort: 'low' | 'medium' | 'high' | null;
  maxTokens: number;
}

// `effort: null` is sent explicitly: Sarvam turns reasoning on when the field is omitted.
// Reasoning tokens count against max_tokens, so higher levels get a larger budget.
// A full analysis of a long document is about 4K tokens of JSON on its own, so
// even Off needs room; High is capped so a 100K-char document still fits sarvam-30b.
export const REASONING_LEVELS: Record<ReasoningLevel, ReasoningInfo> = {
  off: { label: 'Off', effort: null, maxTokens: 8192 },
  low: { label: 'Low', effort: 'low', maxTokens: 16384 },
  medium: { label: 'Medium', effort: 'medium', maxTokens: 20480 },
  high: { label: 'High', effort: 'high', maxTokens: 24576 },
};

export const REASONING_ORDER: readonly ReasoningLevel[] = ['off', 'low', 'medium', 'high'];
export const DEFAULT_REASONING: ReasoningLevel = 'low';

export function isModelId(value: unknown): value is ModelId {
  return typeof value === 'string' && Object.hasOwn(MODELS, value);
}

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === 'string' && Object.hasOwn(REASONING_LEVELS, value);
}

export function lowerReasoning(level: ReasoningLevel): ReasoningLevel | null {
  const i = REASONING_ORDER.indexOf(level);
  return i > 0 ? (REASONING_ORDER[i - 1] ?? null) : null;
}
