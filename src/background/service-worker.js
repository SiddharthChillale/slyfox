// Background worker: injects the page script on toolbar click and runs the
// analysis pipeline. The only extension context that reads the API key.

import { analyze } from '../lib/pipeline.js';
import { loadSettings } from '../lib/settings.js';

const ext = globalThis.browser ?? globalThis.chrome;

// Inserted with scripting.insertCSS so page Content Security Policies can't block it.
const PAGE_CSS = `
::highlight(slyfox-quote) { background-color: #ffd54a; color: #000; }
.slyfox-outline { outline: 3px solid #ffb300 !important; outline-offset: 2px !important; }
`;

ext.action.onClicked.addListener(async (tab) => {
  try {
    await ext.scripting.insertCSS({ target: { tabId: tab.id }, css: PAGE_CSS });
    await ext.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/content.js'] });
  } catch (err) {
    // Browser pages such as chrome:// and the extension stores refuse content scripts.
    console.warn('Slyfox cannot run on this page:', err);
  }
});

function validSegments(segments) {
  return (
    Array.isArray(segments) &&
    segments.every((s) => s && typeof s.id === 'string' && typeof s.text === 'string')
  );
}

// A long-lived port per analysis: progress flows back over it, the page's
// heartbeat keeps the worker alive, and closing the panel aborts the request.
ext.runtime.onConnect.addListener((port) => {
  if (port.name !== 'slyfox') return;
  const controller = new AbortController();
  let disconnected = false;
  port.onDisconnect.addListener(() => {
    disconnected = true;
    controller.abort();
  });
  const post = (msg) => {
    if (!disconnected) port.postMessage(msg);
  };

  port.onMessage.addListener(async (msg) => {
    if (msg?.type !== 'analyze') return;
    if (!validSegments(msg.segments)) {
      post({ type: 'result', result: { status: 'error', code: 'internal', message: 'Slyfox could not read this page.' } });
      return;
    }
    try {
      const settings = await loadSettings();
      const result = await analyze({
        segments: msg.segments,
        hiddenChars: Number(msg.hiddenChars) || 0,
        settings,
        fetchImpl: (...args) => fetch(...args),
        signal: controller.signal,
        onProgress: (step) => post({ type: 'progress', step }),
      });
      post({ type: 'result', result });
    } catch (err) {
      console.error('Slyfox analysis failed:', err);
      post({ type: 'result', result: { status: 'error', code: 'internal', message: 'Something went wrong while analyzing this page.' } });
    }
  });
});

// Content scripts cannot open the options page themselves.
ext.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'open-options') ext.runtime.openOptionsPage();
});
