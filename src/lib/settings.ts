// Settings live in storage.local only: storage.sync would copy the API key
// to every browser signed in to the user's account.

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
