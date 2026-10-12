// Background worker: injects the page script on toolbar click and runs the
// analysis pipeline. The only extension context that reads the API key.

import { type ObservationEnd, Trace, exportTrace } from '../lib/langfuse.ts';
import { analyze } from '../lib/pipeline.ts';
import { loadLangfuseSettings, loadSettings } from '../lib/settings.ts';

const ext = globalThis.browser ?? chrome;

// Inserted with scripting.insertCSS so page Content Security Policies can't block it.
const PAGE_CSS = `
::highlight(slyfox-quote) { background-color: #ffd54a; color: #000; }
.slyfox-outline { outline: 3px solid #ffb300 !important; outline-offset: 2px !important; }
`;

ext.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  try {
    await ext.scripting.insertCSS({ target: { tabId: tab.id }, css: PAGE_CSS });
    await ext.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content/content.js'] });
  } catch (err) {
    // Browser pages such as chrome:// and the extension stores refuse content scripts.
    console.warn('Slyfox cannot run on this page:', err);
  }
});

function isSegmentList(value: unknown): value is Segment[] {
  return (
    Array.isArray(value) &&
    value.every((s) => typeof s === 'object' && s !== null && typeof s.id === 'string' && typeof s.text === 'string')
  );
}

function startTrace(
  config: LangfuseSettings,
  settings: Settings,
  pageUrl: string | undefined,
): { trace: Trace; config: LangfuseSettings } | null {
  if (!config.enabled || !config.publicKey || !config.secretKey) return null;
  const trace = new Trace('analyze-terms', {
    release: ext.runtime.getManifest().version,
    tags: ['slyfox'],
    metadata: {
      model: settings.model,
      reasoning: settings.reasoning,
      ...(config.captureContent ? { pageUrl } : {}),
    },
  });
  return { trace, config };
}

// The root observation's ending: outcome counts always, the summary and
// flags only when the user lets traces carry content.
function traceOutcome(result: AnalysisResult | null): ObservationEnd {
  if (!result) return { level: 'ERROR', statusMessage: 'Slyfox crashed while analyzing this page.' };
  if (result.status === 'error') {
    return { level: 'ERROR', statusMessage: result.message, metadata: { code: result.code } };
  }
  return {
    output: { summary: result.summary, flags: result.flags },
    metadata: {
      flags: result.flags.length,
      droppedCitations: result.stats.droppedCitations,
      redactions: result.redactions,
      hiddenChars: result.hiddenChars,
      chars: result.stats.chars,
      tokens: result.stats.tokens,
      reasoning: result.stats.reasoning,
      injectionChecked: result.injection.checked,
      injectionDetected: result.injection.detected,
    },
    ...(result.injection.detected
      ? { level: 'WARNING' as const, statusMessage: 'The page may contain text aimed at the AI.' }
      : {}),
  };
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
  const post = (msg: WorkerMessage) => {
    if (!disconnected) port.postMessage(msg);
  };
  const failWith = (message: string) => post({ type: 'result', result: { status: 'error', code: 'internal', message } });

  port.onMessage.addListener(async (msg: PageMessage) => {
    if (msg?.type !== 'analyze') return;
    if (!isSegmentList(msg.segments)) {
      failWith('Slyfox could not read this page.');
      return;
    }
    let result: AnalysisResult | null = null;
    let tracing: { trace: Trace; config: LangfuseSettings } | null = null;
    try {
      const [settings, langfuse] = await Promise.all([loadSettings(), loadLangfuseSettings()]);
      tracing = startTrace(langfuse, settings, port.sender?.tab?.url);
      result = await analyze({
        segments: msg.segments,
        hiddenChars: Number(msg.hiddenChars) || 0,
        settings,
        fetchImpl: (url, init) => fetch(url, init),
        signal: controller.signal,
        onProgress: (step) => post({ type: 'progress', step }),
        trace: tracing?.trace.root,
      });
      post({ type: 'result', result });
    } catch (err) {
      console.error('Slyfox analysis failed:', err);
      failWith('Something went wrong while analyzing this page.');
    } finally {
      // Sent after the result so tracing never delays the panel; failures stay in the console.
      if (tracing) {
        tracing.trace.root.end(traceOutcome(result));
        await exportTrace(tracing.trace, tracing.config).catch((err) =>
          console.warn('Slyfox could not send the Langfuse trace:', err),
        );
      }
    }
  });
});

// Content scripts cannot open the options page themselves.
ext.runtime.onMessage.addListener((msg: { type?: string } | undefined) => {
  if (msg?.type === 'open-options') void ext.runtime.openOptionsPage();
});
