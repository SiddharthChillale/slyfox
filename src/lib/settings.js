// Settings live in storage.local only: storage.sync would copy the API key
// to every browser signed in to the user's account.

import { DEFAULT_MODEL, DEFAULT_REASONING, MODELS, REASONING_LEVELS } from './models.js';

const ext = globalThis.browser ?? globalThis.chrome;

export async function loadSettings() {
  const stored = await ext.storage.local.get(['apiKey', 'model', 'reasoning']);
  return {
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : '',
    model: MODELS[stored.model] ? stored.model : DEFAULT_MODEL,
    reasoning: REASONING_LEVELS[stored.reasoning] ? stored.reasoning : DEFAULT_REASONING,
  };
}

export async function saveSettings(patch) {
  await ext.storage.local.set(patch);
}
