// The analysis pipeline: scrub, check length, screen, analyze, verify.
// Pure apart from the injected fetch, so it runs under Node tests as-is.

import { budgetMessage, checkBudget } from './budget.js';
import { ANALYSIS_SCHEMA, SCREEN_SCHEMA, SEVERITIES, buildAnalysisMessages, buildScreeningMessages } from './prompts.js';
import { SarvamError, chat, parseJsonContent } from './sarvam.js';
import { createScrubber } from './scrub.js';
import { verifyFlags } from './verify.js';

const FATAL_SCREEN_ERRORS = new Set(['bad_key', 'aborted', 'rate_limited', 'network', 'model_unavailable']);
const MAX_SUMMARY_BULLETS = 6;

const fail = (code, message) => ({ status: 'error', code, message });

async function screen(segments, common) {
  try {
    const res = await chat({
      ...common,
      messages: buildScreeningMessages(segments),
      reasoning: 'off',
      maxTokens: 512,
      schema: SCREEN_SCHEMA,
    });
    const parsed = parseJsonContent(res.content);
    return {
      checked: true,
      detected: parsed.injection_detected === true,
      evidence: typeof parsed.evidence === 'string' ? parsed.evidence.slice(0, 300) : '',
    };
  } catch (err) {
    // Screening is a warning layer; only errors that would also sink the main call stop the run.
    if (err instanceof SarvamError && !FATAL_SCREEN_ERRORS.has(err.code)) {
      return { checked: false, detected: false, evidence: '' };
    }
    throw err;
  }
}

function cleanFlags(flags) {
  return flags
    .filter((f) => f && typeof f.title === 'string' && typeof f.explanation === 'string')
    .map((f) => ({
      category: typeof f.category === 'string' ? f.category : 'other',
      severity: SEVERITIES.includes(f.severity) ? f.severity : 'medium',
      title: f.title,
      explanation: f.explanation,
      citations: f.citations,
    }));
}

export async function analyze({ segments, hiddenChars = 0, settings, fetchImpl, signal, onProgress = () => {} }) {
  if (!settings.apiKey) return fail('no_key', 'Add your Sarvam API key in Slyfox settings to analyze this page.');

  onProgress('scrub');
  const scrubber = createScrubber();
  const clean = segments.map((s) => ({ id: s.id, text: scrubber.scrub(s.text) }));

  const budget = checkBudget(clean.map((s) => s.text).join('\n'), settings);
  if (!budget.ok) return fail(budget.code, budgetMessage(budget, settings));

  const common = { apiKey: settings.apiKey, model: settings.model, fetchImpl, signal };
  try {
    onProgress('screen');
    const injection = await screen(clean, common);

    onProgress('analyze');
    const res = await chat({
      ...common,
      messages: buildAnalysisMessages(clean),
      reasoning: settings.reasoning,
      schema: ANALYSIS_SCHEMA,
    });
    if (res.finishReason === 'length') {
      return fail('cut_off', 'Analysis was cut off before it finished. Try a lower reasoning level.');
    }
    const parsed = parseJsonContent(res.content);

    onProgress('verify');
    const { flags, droppedCitations } = verifyFlags(cleanFlags(Array.isArray(parsed.flags) ? parsed.flags : []), clean);
    flags.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

    return {
      status: 'ok',
      summary: (Array.isArray(parsed.summary) ? parsed.summary : [])
        .filter((s) => typeof s === 'string')
        .slice(0, MAX_SUMMARY_BULLETS),
      flags,
      injection,
      hiddenChars,
      redactions: scrubber.total,
      stats: {
        model: settings.model,
        reasoning: res.reasoning,
        chars: budget.chars,
        tokens: budget.tokens,
        droppedCitations,
      },
    };
  } catch (err) {
    if (err instanceof SarvamError) return fail(err.code, err.message);
    throw err;
  }
}
