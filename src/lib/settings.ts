// Settings live in storage.local only: storage.sync would copy the API key
// to every browser signed in to the user's account.

import { DEFAULT_LANGFUSE_HOST } from './langfuse.ts';
import { DEFAULT_MODEL, DEFAULT_REASONING, isModelId, isReasoningLevel } from './models.ts';

const ext = globalThis.browser ?? chrome;

export async function loadSettings(): Promise<Settings> {
  const stored: Record<string, unknown> = await ext.storage.local.get(['apiKey', 'model', 'reasoning']);
  return {
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
    model: isModelId(stored.model) ? stored.model : DEFAULT_MODEL,
    reasoning: isReasoningLevel(stored.reasoning) ? stored.reasoning : DEFAULT_REASONING,
  };
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await ext.storage.local.set(patch);
}

// Langfuse settings sit under one key, apart from the analysis settings the pipeline reads.
export async function loadLangfuseSettings(): Promise<LangfuseSettings> {
  const { langfuse }: Record<string, unknown> = await ext.storage.local.get('langfuse');
  const stored = (typeof langfuse === 'object' && langfuse !== null ? langfuse : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  return {
    enabled: stored.enabled === true,
    host: text(stored.host) || DEFAULT_LANGFUSE_HOST,
    publicKey: text(stored.publicKey),
    secretKey: text(stored.secretKey),
    captureContent: stored.captureContent !== false,
  };
}

export async function saveLangfuseSettings(value: LangfuseSettings): Promise<void> {
  await ext.storage.local.set({ langfuse: value });
}
