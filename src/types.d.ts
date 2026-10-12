// Shapes shared by the page script, the background worker and the pipeline.
// Ambient rather than exported: the page script is a classic script and
// cannot import, so these are visible everywhere without an import.

type ModelId = 'sarvam-105b' | 'sarvam-30b';
type ReasoningLevel = 'off' | 'low' | 'medium' | 'high';
type Severity = 'high' | 'medium' | 'low';
type ProgressStep = 'extract' | 'scrub' | 'screen' | 'analyze' | 'verify';

interface Settings {
  apiKey: string;
  model: ModelId;
  reasoning: ReasoningLevel;
}

interface LangfuseSettings {
  enabled: boolean;
  host: string;
  publicKey: string;
  secretKey: string;
  // Send prompts, responses and the page address, not just timings and counts.
  captureContent: boolean;
}

interface Segment {
  id: string;
  text: string;
}

interface Citation {
  segmentId: string;
  quote: string;
}

interface Flag {
  category: string;
  severity: Severity;
  title: string;
  explanation: string;
  citations: Citation[];
}

interface InjectionCheck {
  checked: boolean;
  detected: boolean;
  evidence: string;
}

type ErrorCode =
  | 'no_key'
  | 'no_terms'
  | 'too_long'
  | 'too_many_tokens'
  | 'bad_key'
  | 'rate_limited'
  | 'server'
  | 'bad_request'
  | 'model_unavailable'
  | 'network'
  | 'aborted'
  | 'bad_response'
  | 'cut_off'
  | 'internal';

interface AnalysisSuccess {
  status: 'ok';
  summary: string[];
  flags: Flag[];
  injection: InjectionCheck;
  hiddenChars: number;
  redactions: number;
  stats: {
    model: ModelId;
    reasoning: ReasoningLevel;
    chars: number;
    tokens: number;
    droppedCitations: number;
  };
}

interface AnalysisFailure {
  status: 'error';
  code: ErrorCode;
  message: string;
}

type AnalysisResult = AnalysisSuccess | AnalysisFailure;

// Messages over the long-lived port between the page script and the background worker.
type PageMessage = { type: 'analyze'; segments: Segment[]; hiddenChars: number } | { type: 'ping' };
type WorkerMessage = { type: 'progress'; step: ProgressStep } | { type: 'result'; result: AnalysisResult };

// Firefox exposes `browser`; Chromium only `chrome`. Both have the same promise-based API.
declare var browser: typeof chrome | undefined;

interface Window {
  __slyfox?: { toggle(): void };
}
