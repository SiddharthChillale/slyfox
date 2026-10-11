// The analysis pipeline: scrub, check length, screen, analyze, verify.
// Pure apart from the injected fetch, so it runs under Node tests as-is.

import { budgetMessage, checkBudget } from './budget.ts';
import { ANALYSIS_SCHEMA, SCREEN_SCHEMA, SEVERITIES, buildAnalysisMessages, buildScreeningMessages } from './prompts.ts';
import { type FetchLike, SarvamError, chat, parseJsonContent } from './sarvam.ts';
import { createScrubber } from './scrub.ts';
import { verifyFlags } from './verify.ts';

const FATAL_SCREEN_ERRORS = new Set<ErrorCode>(['bad_key', 'aborted', 'rate_limited', 'network', 'model_unavailable']);
const MAX_SUMMARY_BULLETS = 6;

export interface AnalyzeOptions {
  segments: Segment[];
  hiddenChars?: number;
  settings: Settings;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  onProgress?: (step: ProgressStep) => void;
}

type Common = Pick<AnalyzeOptions, 'fetchImpl' | 'signal'> & { apiKey: string; model: ModelId };

const fail = (code: ErrorCode, message: string): AnalysisFailure => ({ status: 'error', code, message });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSeverity = (value: unknown): value is Severity => SEVERITIES.includes(value as Severity);

async function screen(segments: Segment[], common: Common): Promise<InjectionCheck> {
  try {
    const res = await chat({
      ...common,
      messages: buildScreeningMessages(segments),
      reasoning: 'off',
      maxTokens: 512,
      schema: SCREEN_SCHEMA,
    });
    const parsed = parseJsonContent(res.content);
    if (!isRecord(parsed)) return { checked: false, detected: false, evidence: '' };
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

// Model output is untrusted: keep only well-formed flags and citations.
function cleanFlags(raw: unknown): Flag[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).flatMap((f) => {
    if (typeof f.title !== 'string' || typeof f.explanation !== 'string') return [];
    const citations = Array.isArray(f.citations)
      ? f.citations
          .filter(isRecord)
          .filter((c) => typeof c.segmentId === 'string' && typeof c.quote === 'string')
          .map((c) => ({ segmentId: c.segmentId as string, quote: c.quote as string }))
      : [];
    return [
      {
        category: typeof f.category === 'string' ? f.category : 'other',
        severity: isSeverity(f.severity) ? f.severity : 'medium',
        title: f.title,
        explanation: f.explanation,
        citations,
      },
    ];
  });
}

export async function analyze({
  segments,
  hiddenChars = 0,
  settings,
  fetchImpl,
  signal,
  onProgress = () => {},
}: AnalyzeOptions): Promise<AnalysisResult> {
  if (!settings.apiKey) return fail('no_key', 'Add your Sarvam API key in Slyfox settings to analyze this page.');

  onProgress('scrub');
  const scrubber = createScrubber();
  const clean = segments.map((s) => ({ id: s.id, text: scrubber.scrub(s.text) }));

  const budget = checkBudget(clean.map((s) => s.text).join('\n'), settings);
  if (!budget.ok) return fail(budget.code, budgetMessage(budget, settings));

  const common: Common = { apiKey: settings.apiKey, model: settings.model, fetchImpl, signal };
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
    const body = isRecord(parsed) ? parsed : {};

    onProgress('verify');
    const { flags, droppedCitations } = verifyFlags(cleanFlags(body.flags), clean);
    flags.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

    return {
      status: 'ok',
      summary: (Array.isArray(body.summary) ? body.summary : [])
        .filter((s): s is string => typeof s === 'string')
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
