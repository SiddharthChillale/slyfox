// A fake fetch that replays queued responses and records each request.

import type { FetchLike } from '../src/lib/sarvam.ts';

export interface FakeResponse {
  status?: number;
  json?: unknown;
  text?: string;
}

export interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export function fakeFetch(responses: (FakeResponse | Error)[]): { impl: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const impl: FetchLike = async (url, init) => {
    const body = init.body === undefined ? {} : (JSON.parse(init.body) as Record<string, unknown>);
    calls.push({ url, body, headers: init.headers });
    const next = queue.shift();
    if (!next) throw new Error('fakeFetch: no response queued');
    if (next instanceof Error) throw next;
    const { status = 200, json, text = '' } = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => (json === undefined ? text : JSON.stringify(json)),
    };
  };
  return { impl, calls };
}

export const completion = (content: unknown, finishReason = 'stop'): FakeResponse => ({
  json: {
    choices: [
      { message: { content: typeof content === 'string' ? content : JSON.stringify(content) }, finish_reason: finishReason },
    ],
  },
});

// Index into recorded calls without a non-null assertion at every use.
export function call(calls: RecordedCall[], index: number): RecordedCall {
  const found = calls[index];
  if (!found) throw new Error(`fakeFetch: no call #${index}`);
  return found;
}
