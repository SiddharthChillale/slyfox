import { MODELS, REASONING_LEVELS, REASONING_ORDER, SARVAM_ORIGIN } from '../lib/models.js';
import { testConnection } from '../lib/sarvam.js';
import { loadSettings, saveSettings } from '../lib/settings.js';

const ext = globalThis.browser ?? globalThis.chrome;

const form = document.getElementById('settings');
const keyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('model');
const reasoningSelect = document.getElementById('reasoning');
const status = document.getElementById('status');
const saveButton = document.getElementById('save');
const testButton = document.getElementById('test');

let savedModel;

for (const [id, model] of Object.entries(MODELS)) {
  modelSelect.append(new Option(model.label, id));
}
for (const id of REASONING_ORDER) {
  reasoningSelect.append(new Option(REASONING_LEVELS[id].label, id));
}

function show(message, tone = '') {
  status.textContent = message;
  status.className = tone;
}

function busy(on) {
  saveButton.disabled = on;
  testButton.disabled = on;
}

// Firefox grants MV3 host permissions only on request, and only inside the
// click's user gesture, so this must be the first await in each handler.
function requestSarvamAccess() {
  return ext.permissions.request({ origins: [SARVAM_ORIGIN] }).catch(() => false);
}

async function check() {
  const apiKey = keyInput.value.trim();
  if (!apiKey) {
    show('Enter your Sarvam API key.', 'bad');
    return null;
  }
  show(`Checking the key with ${modelSelect.value}…`);
  return { apiKey, result: await testConnection({ apiKey, model: modelSelect.value }) };
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
    const model = modelSelect.value;
    const reasoning = reasoningSelect.value;

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
    show(result.ok ? `Connected to ${modelSelect.value}.` : result.message, result.ok ? 'good' : 'bad');
  } finally {
    busy(false);
  }
});

document.getElementById('toggleKey').addEventListener('click', (event) => {
  const hidden = keyInput.type === 'password';
  keyInput.type = hidden ? 'text' : 'password';
  event.currentTarget.textContent = hidden ? 'Hide' : 'Show';
});

const settings = await loadSettings();
keyInput.value = settings.apiKey;
modelSelect.value = settings.model;
reasoningSelect.value = settings.reasoning;
savedModel = settings.model;
