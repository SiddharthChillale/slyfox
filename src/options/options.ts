import { hostPermission, normalizeHost, testLangfuse } from '../lib/langfuse.ts';
import { MODELS, REASONING_LEVELS, REASONING_ORDER, SARVAM_ORIGIN, isModelId, isReasoningLevel } from '../lib/models.ts';
import { type ConnectionResult, testConnection } from '../lib/sarvam.ts';
import { loadLangfuseSettings, loadSettings, saveLangfuseSettings, saveSettings } from '../lib/settings.ts';

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

const tracingForm = byId<HTMLFormElement>('tracing');
const lfEnabled = byId<HTMLInputElement>('lfEnabled');
const lfHost = byId<HTMLInputElement>('lfHost');
const lfPublicKey = byId<HTMLInputElement>('lfPublicKey');
const lfSecretKey = byId<HTMLInputElement>('lfSecretKey');
const lfContent = byId<HTMLInputElement>('lfContent');
const lfStatus = byId<HTMLParagraphElement>('lfStatus');
const lfSaveButton = byId<HTMLButtonElement>('lfSave');
const lfTestButton = byId<HTMLButtonElement>('lfTest');
const toggleSecretButton = byId<HTMLButtonElement>('toggleSecret');

let savedModel: ModelId;

for (const [id, model] of Object.entries(MODELS)) {
  modelSelect.append(new Option(model.label, id));
}
for (const id of REASONING_ORDER) {
  reasoningSelect.append(new Option(REASONING_LEVELS[id].label, id));
}

type Tone = '' | 'good' | 'bad';

const reporter = (el: HTMLElement) => (message: string, tone: Tone = '') => {
  el.textContent = message;
  el.dataset.tone = tone;
};
const show = reporter(status);
const showTracing = reporter(lfStatus);

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

function revealToggle(button: HTMLButtonElement, input: HTMLInputElement) {
  button.addEventListener('click', () => {
    const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    button.textContent = hidden ? 'Hide' : 'Show';
  });
}
revealToggle(toggleKeyButton, keyInput);
revealToggle(toggleSecretButton, lfSecretKey);

function tracingBusy(on: boolean) {
  lfSaveButton.disabled = on;
  lfTestButton.disabled = on;
}

// Reads the tracing form; returns an error message instead when the keys
// are needed (`requireKeys`) and missing, or the host is unusable.
function readTracing(requireKeys: boolean): LangfuseSettings | string {
  const host = normalizeHost(lfHost.value);
  if (!host) return 'Enter an https:// Langfuse host (plain http only works for localhost).';
  const config: LangfuseSettings = {
    enabled: lfEnabled.checked,
    host,
    publicKey: lfPublicKey.value.trim(),
    secretKey: lfSecretKey.value.trim(),
    captureContent: lfContent.checked,
  };
  if (requireKeys && (!config.publicKey || !config.secretKey)) return 'Enter your Langfuse public and secret keys.';
  return config;
}

// Same rule as Sarvam: in Firefox the request must be the first await in a click handler.
function requestLangfuseAccess(host: string): Promise<boolean> {
  return ext.permissions.request({ origins: [hostPermission(host)] }).catch(() => false);
}

async function checkTracing(config: LangfuseSettings): Promise<{ ok: boolean; message: string }> {
  showTracing(`Checking the keys with ${config.host}…`);
  const result = await testLangfuse(config);
  if (!result.ok) return result;
  return {
    ok: true,
    message: result.project ? `Connected to the Langfuse project “${result.project}”.` : 'Connected to Langfuse.',
  };
}

tracingForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const config = readTracing(lfEnabled.checked);
  if (typeof config === 'string') {
    showTracing(config, 'bad');
    return;
  }
  if (!config.enabled) {
    await saveLangfuseSettings(config);
    showTracing('Saved. Tracing is off.', 'good');
    return;
  }
  if (!(await requestLangfuseAccess(config.host))) {
    showTracing(`Slyfox needs permission to reach ${new URL(config.host).hostname} to send traces.`, 'bad');
    return;
  }
  tracingBusy(true);
  try {
    const { ok, message } = await checkTracing(config);
    if (!ok) {
      showTracing(`${message} Nothing was saved.`, 'bad');
      return;
    }
    await saveLangfuseSettings(config);
    lfHost.value = config.host;
    showTracing(`Saved. ${message}`, 'good');
  } finally {
    tracingBusy(false);
  }
});

lfTestButton.addEventListener('click', async () => {
  const config = readTracing(true);
  if (typeof config === 'string') {
    showTracing(config, 'bad');
    return;
  }
  if (!(await requestLangfuseAccess(config.host))) {
    showTracing(`Slyfox needs permission to reach ${new URL(config.host).hostname} to test the connection.`, 'bad');
    return;
  }
  tracingBusy(true);
  try {
    const { ok, message } = await checkTracing(config);
    showTracing(message, ok ? 'good' : 'bad');
  } finally {
    tracingBusy(false);
  }
});

const [settings, tracing] = await Promise.all([loadSettings(), loadLangfuseSettings()]);
keyInput.value = settings.apiKey;
modelSelect.value = settings.model;
reasoningSelect.value = settings.reasoning;
savedModel = settings.model;
lfEnabled.checked = tracing.enabled;
lfHost.value = tracing.host;
lfPublicKey.value = tracing.publicKey;
lfSecretKey.value = tracing.secretKey;
lfContent.checked = tracing.captureContent;
