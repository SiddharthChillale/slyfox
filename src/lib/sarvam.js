// Minimal Sarvam chat-completions client. Called only from the background
// worker and the settings page, the two places that may hold the API key.

import { SARVAM_CHAT_URL, REASONING_LEVELS, lowerReasoning } from './models.js';

export class SarvamError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = 'SarvamError';
    this.code = code;
    this.status = status;
  }
}

function errorFor(status, detail) {
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

async function request({ apiKey, model, messages, reasoning = 'off', schema, maxTokens, fetchImpl = fetch, signal }) {
  const level = REASONING_LEVELS[reasoning];
  const body = {
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

  let res;
  try {
    res = await fetchImpl(SARVAM_CHAT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'api-subscription-key': apiKey },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new SarvamError('aborted', 'Request cancelled.');
    throw new SarvamError('network', `Could not reach Sarvam: ${err?.message ?? err}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw errorFor(res.status, detail);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    finishReason: choice?.finish_reason ?? null,
    usage: data.usage ?? null,
    reasoning,
  };
}

// The docs disagree on which reasoning levels exist, so a 400 on a reasoning
// level retries once at the next level down.
export async function chat(opts) {
  try {
    return await request(opts);
  } catch (err) {
    const lower = lowerReasoning(opts.reasoning ?? 'off');
    if (err.code === 'bad_request' && lower) {
      return request({ ...opts, reasoning: lower });
    }
    throw err;
  }
}

export function parseJsonContent(content) {
  const text = String(content)
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

export async function testConnection({ apiKey, model, fetchImpl }) {
  try {
    await request({
      apiKey,
      model,
      fetchImpl,
      reasoning: 'off',
      maxTokens: 16,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof SarvamError) return { ok: false, code: err.code, message: err.message };
    throw err;
  }
}
