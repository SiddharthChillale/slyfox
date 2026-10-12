// Langfuse tracing over its OpenTelemetry endpoint. Spans are recorded in
// memory while an analysis runs and sent as one OTLP/HTTP JSON export when it
// ends, so tracing never slows down or breaks an analysis. Only the background
// worker and the settings page call this; both may hold the Langfuse keys.

import type { FetchLike } from './sarvam.ts';

export const DEFAULT_LANGFUSE_HOST = 'https://cloud.langfuse.com';

// Opts in to Langfuse's current (v4) OTLP ingestion, as its docs recommend.
const INGESTION_VERSION = '4';

type Level = 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';

export interface ObservationInit {
  type?: 'span' | 'generation';
  input?: unknown;
  metadata?: Record<string, unknown>;
  model?: string;
  modelParameters?: Record<string, unknown>;
}

export interface ObservationEnd {
  output?: unknown;
  metadata?: Record<string, unknown>;
  usage?: Record<string, number>;
  level?: Level;
  statusMessage?: string;
}

export interface Span {
  child(name: string, init?: ObservationInit): Span;
  end(result?: ObservationEnd): void;
}

// Stands in when tracing is off, so callers never branch on it.
export const NOOP_SPAN: Span = { child: () => NOOP_SPAN, end: () => {} };

interface ObservationRecord {
  spanId: string;
  parentSpanId: string | undefined;
  name: string;
  init: ObservationInit;
  start: number;
  end?: number;
  result?: ObservationEnd;
}

export interface TraceInfo {
  release?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

type AttributeValue =
  | { stringValue: string }
  | { intValue: string }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: AttributeValue[] } };

interface Attribute {
  key: string;
  value: AttributeValue;
}

// Fractional milliseconds since the epoch.
const now = () => performance.timeOrigin + performance.now();

// Nanoseconds overflow a double's integer precision, so go through BigInt.
const nanos = (ms: number) => (BigInt(Math.round(ms * 1000)) * 1000n).toString();

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const asText = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

function attributeValue(value: unknown): AttributeValue {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  return { stringValue: JSON.stringify(value) ?? '' };
}

function attributes(entries: [string, unknown][]): Attribute[] {
  return entries.filter(([, v]) => v !== undefined && v !== null).map(([key, v]) => ({ key, value: attributeValue(v) }));
}

const prefixed = (prefix: string, metadata: Record<string, unknown> | undefined): [string, unknown][] =>
  Object.entries(metadata ?? {}).map(([k, v]) => [`${prefix}.${k}`, v]);

export class Trace {
  readonly traceId = randomHex(16);
  readonly root: Span;
  private readonly name: string;
  private readonly info: TraceInfo;
  private readonly records: ObservationRecord[] = [];

  constructor(name: string, info: TraceInfo = {}) {
    this.name = name;
    this.info = info;
    this.root = this.open(name, {}, undefined);
  }

  private open(name: string, init: ObservationInit, parentSpanId: string | undefined): Span {
    const record: ObservationRecord = { spanId: randomHex(8), parentSpanId, name, init, start: now() };
    this.records.push(record);
    return {
      child: (childName, childInit = {}) => this.open(childName, childInit, record.spanId),
      end: (result = {}) => {
        if (record.end !== undefined) return;
        record.end = now();
        record.result = result;
      },
    };
  }

  // Input and output carry the scrubbed page text and the model's answers;
  // with captureContent off only timings, token counts and errors are sent.
  toOtlp({ captureContent }: { captureContent: boolean }) {
    const traceAttributes = attributes([
      ['langfuse.trace.name', this.name],
      ['langfuse.release', this.info.release],
      ...prefixed('langfuse.trace.metadata', this.info.metadata),
    ]);
    if (this.info.tags?.length) {
      traceAttributes.push({
        key: 'langfuse.trace.tags',
        value: { arrayValue: { values: this.info.tags.map((stringValue) => ({ stringValue })) } },
      });
    }

    const spans = this.records.map((r) => {
      const result = r.result ?? {};
      const failed = result.level === 'ERROR';
      return {
        traceId: this.traceId,
        spanId: r.spanId,
        ...(r.parentSpanId ? { parentSpanId: r.parentSpanId } : {}),
        name: r.name,
        kind: 1,
        startTimeUnixNano: nanos(r.start),
        // A span still open here was cut short by a crash.
        endTimeUnixNano: nanos(r.end ?? now()),
        attributes: [
          ...(r.parentSpanId ? [] : traceAttributes),
          ...attributes([
            ['langfuse.observation.type', r.init.type ?? 'span'],
            ['langfuse.observation.input', captureContent && r.init.input !== undefined ? asText(r.init.input) : undefined],
            ['langfuse.observation.output', captureContent && result.output !== undefined ? asText(result.output) : undefined],
            ['langfuse.observation.model.name', r.init.model],
            ['langfuse.observation.model.parameters', r.init.modelParameters && JSON.stringify(r.init.modelParameters)],
            ['langfuse.observation.usage_details', result.usage && JSON.stringify(result.usage)],
            ['langfuse.observation.level', result.level],
            ['langfuse.observation.status_message', result.statusMessage],
            ...prefixed('langfuse.observation.metadata', { ...r.init.metadata, ...result.metadata }),
          ]),
        ],
        status: failed ? { code: 2, message: result.statusMessage ?? '' } : { code: 0 },
      };
    });

    return {
      resourceSpans: [
        {
          resource: { attributes: attributes([['service.name', 'slyfox'], ['service.version', this.info.release]]) },
          scopeSpans: [{ scope: { name: 'slyfox' }, spans }],
        },
      ],
    };
  }
}

// Maps an OpenAI-style usage block onto Langfuse's usage keys.
export function usageDetails(usage: unknown): Record<string, number> | undefined {
  if (typeof usage !== 'object' || usage === null) return undefined;
  const u = usage as Record<string, unknown>;
  const pairs = Object.entries({ input: u.prompt_tokens, output: u.completion_tokens, total: u.total_tokens }).filter(
    (pair): pair is [string, number] => typeof pair[1] === 'number',
  );
  return pairs.length ? Object.fromEntries(pairs) : undefined;
}

// Accepts https anywhere and plain http only on this machine, matching the
// optional host permissions in the manifest. Returns null for anything else.
export function normalizeHost(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value.trim() || DEFAULT_LANGFUSE_HOST);
  } catch {
    return null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

// Match patterns ignore ports, and Firefox rejects patterns that include one.
export function hostPermission(host: string): string {
  const url = new URL(host);
  return `${url.protocol}//${url.hostname}/*`;
}

function authHeaders({ publicKey, secretKey }: LangfuseSettings): Record<string, string> {
  return { authorization: `Basic ${btoa(`${publicKey}:${secretKey}`)}` };
}

export async function exportTrace(trace: Trace, config: LangfuseSettings, fetchImpl: FetchLike = fetch): Promise<void> {
  const res = await fetchImpl(`${config.host}/api/public/otel/v1/traces`, {
    method: 'POST',
    headers: {
      ...authHeaders(config),
      'content-type': 'application/json',
      'x-langfuse-ingestion-version': INGESTION_VERSION,
    },
    body: JSON.stringify(trace.toOtlp(config)),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Langfuse rejected the trace: HTTP ${res.status} ${detail.slice(0, 200)}`.trim());
  }
}

export type LangfuseConnection = { ok: true; project: string | null } | { ok: false; message: string };

// The projects endpoint answers with the project the keys belong to.
export async function testLangfuse(config: LangfuseSettings, fetchImpl: FetchLike = fetch): Promise<LangfuseConnection> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(`${config.host}/api/public/projects`, { method: 'GET', headers: authHeaders(config) });
  } catch (err) {
    return { ok: false, message: `Could not reach ${config.host}: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, message: 'Langfuse rejected the public or secret key.' };
  if (!res.ok) return { ok: false, message: `Langfuse answered with HTTP ${res.status}. Check the host.` };
  const data = (await res.json().catch(() => null)) as { data?: { name?: unknown }[] } | null;
  const name = data?.data?.[0]?.name;
  return { ok: true, project: typeof name === 'string' ? name : null };
}
