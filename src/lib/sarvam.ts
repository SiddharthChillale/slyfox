// Minimal Sarvam chat-completions client. Called only from the background
// worker and the settings page, the two places that may hold the API key.

import { type Span, usageDetails } from './langfuse.ts';
import { REASONING_LEVELS, SARVAM_CHAT_URL, lowerReasoning } from './models.ts';
import type { ChatMessage, JsonSchemaFormat } from './prompts.ts';

export class SarvamError extends Error {
  code: ErrorCode;
  status: number | undefined;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'SarvamError';
    this.code = code;
    this.status = status;
  }
}

// The subset of fetch the client uses, so tests can pass a fake.
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal | undefined },
) => Promise<Pick<Response, 'ok' | 'status' | 'json' | 'text'>>;

export interface ChatOptions {
  apiKey: string;
  model: ModelId;
  messages: ChatMessage[];
  reasoning?: ReasoningLevel;
  schema?: JsonSchemaFormat;
  maxTokens?: number;
  fetchImpl?: FetchLike;
  signal?: AbortSignal | undefined;
  // Records each request as a Langfuse generation under `parent`.
  observe?: { parent: Span; name: string };
}

export interface ChatResult {
  content: string;
  finishReason: string | null;
  usage: unknown;
  reasoning: ReasoningLevel;
}

interface CompletionResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: unknown;
}

function errorFor(status: number, detail: string): SarvamError {
  const short = detail.slice(0, 300);
  if (status === 401 || status === 403) {
    return new SarvamError('bad_key', 'Sarvam rejected the API key.', status);
  }
  if (status === 429) {
    return new SarvamError('rate_limited', 'Sarvam rate limit reached. Wait a minute and try again.', status);
  }
  if (status >= 500) {
    return new SarvamError('server', 'Sarvam is having problems. Try again shortly.', status);
  }
  if (/reasoning/i.test(detail)) {
    return new SarvamError('bad_request', `Sarvam rejected the reasoning setting: ${short}`, status);
  }
  if (/model/i.test(detail)) {
    return new SarvamError('model_unavailable', 'This model is not available on your key.', status);
  }
  return new SarvamError('bad_request', `Sarvam rejected the request: ${short || `HTTP ${status}`}`, status);
}

function requestBody({ model, messages, reasoning = 'off', schema, maxTokens }: ChatOptions): Record<string, unknown> {
  const level = REASONING_LEVELS[reasoning];
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens ?? level.maxTokens,
    reasoning_effort: level.effort,
  };
  if (schema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: schema.name, strict: true, schema: schema.schema },
    };
  }
  return body;
}

async function send(
  { apiKey, reasoning = 'off', fetchImpl = fetch, signal }: ChatOptions,
  body: Record<string, unknown>,
): Promise<ChatResult> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(SARVAM_CHAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-subscription-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new SarvamError('aborted', 'Request cancelled.');
    throw new SarvamError('network', `Could not reach Sarvam: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw errorFor(res.status, detail);
  }

  const data = (await res.json()) as CompletionResponse;
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    usage: data.usage ?? null,
    reasoning,
  };
}

async function request(opts: ChatOptions): Promise<ChatResult> {
  const body = requestBody(opts);
  if (!opts.observe) return send(opts, body);

  const { messages, model: _model, ...modelParameters } = body;
  const generation = opts.observe.parent.child(opts.observe.name, {
    type: 'generation',
    input: messages,
    model: opts.model,
    modelParameters: { ...modelParameters, response_format: opts.schema?.name },
  });
  try {
    const result = await send(opts, body);
    generation.end({
      output: result.content,
      usage: usageDetails(result.usage),
      metadata: { finishReason: result.finishReason },
    });
    return result;
  } catch (err) {
    generation.end({
      level: 'ERROR',
      statusMessage: err instanceof Error ? err.message : String(err),
      metadata: err instanceof SarvamError ? { code: err.code, status: err.status } : {},
    });
    throw err;
  }
}

// The docs disagree on which reasoning levels exist, so a 400 on a reasoning
// level retries once at the next level down.
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  try {
    return await request(opts);
  } catch (err) {
    const lower = lowerReasoning(opts.reasoning ?? 'off');
    if (err instanceof SarvamError && err.code === 'bad_request' && lower) {
      return request({ ...opts, reasoning: lower });
    }
    throw err;
  }
}

export function parseJsonContent(content: string): unknown {
  const text = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new SarvamError('bad_response', 'Sarvam returned a response Slyfox could not read.');
  }
}

export type ConnectionResult = { ok: true } | { ok: false; code: ErrorCode; message: string };

export async function testConnection({
  apiKey,
  model,
  fetchImpl,
}: {
  apiKey: string;
  model: ModelId;
  fetchImpl?: FetchLike;
}): Promise<ConnectionResult> {
  try {
    await request({
      apiKey,
      model,
      reasoning: 'off',
      maxTokens: 16,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      ...(fetchImpl ? { fetchImpl } : {}),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof SarvamError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
}
