import { MODELS, REASONING_LEVELS, REASONING_ORDER, SARVAM_ORIGIN, isModelId, isReasoningLevel } from '../lib/models.ts';
import { type ConnectionResult, testConnection } from '../lib/sarvam.ts';
import { loadSettings, saveSettings } from '../lib/settings.ts';

const ext = globalThis.browser ?? chrome;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = byId<HTMLFormElement>('settings');
const keyInput = byId<HTMLInputElement>('apiKey');
const modelSelect = byId<HTMLSelectElement>('model');
const reasoningSelect = byId<HTMLSelectElement>('reasoning');
const status = byId<HTMLParagraphElement>('status');
const saveButton = byId<HTMLButtonElement>('save');
const testButton = byId<HTMLButtonElement>('test');
const toggleKeyButton = byId<HTMLButtonElement>('toggleKey');

let savedModel: ModelId;

for (const [id, model] of Object.entries(MODELS)) {
  modelSelect.append(new Option(model.label, id));
}
for (const id of REASONING_ORDER) {
  reasoningSelect.append(new Option(REASONING_LEVELS[id].label, id));
}

function show(message: string, tone: '' | 'good' | 'bad' = '') {
  status.textContent = message;
  status.className = tone;
}

function busy(on: boolean) {
  saveButton.disabled = on;
  testButton.disabled = on;
}

function selectedModel(): ModelId {
  return isModelId(modelSelect.value) ? modelSelect.value : savedModel;
}

function selectedReasoning(): ReasoningLevel {
  return isReasoningLevel(reasoningSelect.value) ? reasoningSelect.value : 'low';
}

// Firefox grants MV3 host permissions only on request, and only inside the
// click's user gesture, so this must be the first await in each handler.
function requestSarvamAccess(): Promise<boolean> {
  return ext.permissions.request({ origins: [SARVAM_ORIGIN] }).catch(() => false);
}

async function check(): Promise<{ apiKey: string; result: ConnectionResult } | null> {
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    show('Enter your Sarvam API key.', 'bad');
    return null;
  }
  show(`Checking the key with ${selectedModel()}…`);
  return { apiKey, result: await testConnection({ apiKey, model: selectedModel() }) };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!(await requestSarvamAccess())) {
    show('Slyfox needs permission to reach api.sarvam.ai to analyze pages.', 'bad');
    return;
  }
  busy(true);
  try {
    const checked = await check();
    if (!checked) return;
    const { apiKey, result } = checked;
    const model = selectedModel();
    const reasoning = selectedReasoning();

    if (result.ok) {
      await saveSettings({ apiKey, model, reasoning });
      savedModel = model;
      show(`Saved. Connected to ${model}.`, 'good');
    } else if (result.code === 'model_unavailable') {
      await saveSettings({ apiKey, reasoning });
      modelSelect.value = savedModel;
      show(`${model} isn't available on your key. Kept ${savedModel}; key and reasoning were saved.`, 'bad');
    } else {
      show(`${result.message} Nothing was saved.`, 'bad');
    }
  } finally {
    busy(false);
  }
});

testButton.addEventListener('click', async () => {
  if (!(await requestSarvamAccess())) {
    show('Slyfox needs permission to reach api.sarvam.ai to test the connection.', 'bad');
    return;
  }
  busy(true);
  try {
    const checked = await check();
    if (!checked) return;
    const { result } = checked;
    if (result.ok) show(`Connected to ${selectedModel()}.`, 'good');
    else show(result.message, 'bad');
  } finally {
    busy(false);
  }
});

toggleKeyButton.addEventListener('click', () => {
  const hidden = keyInput.type === 'password';
  keyInput.type = hidden ? 'text' : 'password';
  toggleKeyButton.textContent = hidden ? 'Hide' : 'Show';
});

const settings = await loadSettings();
keyInput.value = settings.apiKey;
modelSelect.value = settings.model;
reasoningSelect.value = settings.reasoning;
savedModel = settings.model;
