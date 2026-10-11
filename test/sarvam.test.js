import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SARVAM_CHAT_URL } from '../src/lib/models.js';
import { SarvamError, chat, parseJsonContent, testConnection } from '../src/lib/sarvam.js';
import { completion, fakeFetch } from './helpers.js';

const base = { apiKey: 'test-key', model: 'sarvam-105b', messages: [{ role: 'user', content: 'hi' }] };

test('sends the key header and an explicit null reasoning_effort when reasoning is off', async () => {
  const { impl, calls } = fakeFetch([completion('ok')]);
  await chat({ ...base, reasoning: 'off', fetchImpl: impl });
  assert.equal(calls[0].url, SARVAM_CHAT_URL);
  assert.equal(calls[0].headers['api-subscription-key'], 'test-key');
  assert.ok('reasoning_effort' in calls[0].body);
  assert.equal(calls[0].body.reasoning_effort, null);
  assert.equal(calls[0].body.max_tokens, 4096);
});

test('maps reasoning levels to effort and token budgets', async () => {
  const { impl, calls } = fakeFetch([completion('ok')]);
  await chat({ ...base, reasoning: 'high', fetchImpl: impl });
  assert.equal(calls[0].body.reasoning_effort, 'high');
  assert.equal(calls[0].body.max_tokens, 16384);
});

test('retries once at the next lower level when a reasoning level is rejected', async () => {
  const { impl, calls } = fakeFetch([{ status: 400, text: 'invalid reasoning_effort: medium' }, completion('ok')]);
  const res = await chat({ ...base, reasoning: 'medium', fetchImpl: impl });
  assert.deepEqual(
    calls.map((c) => c.body.reasoning_effort),
    ['medium', 'low'],
  );
  assert.equal(res.reasoning, 'low');
});

test('maps HTTP errors to codes', async () => {
  const cases = [
    [{ status: 403, text: 'Invalid API key' }, 'bad_key'],
    [{ status: 429, text: '' }, 'rate_limited'],
    [{ status: 400, text: 'model sarvam-30b is not supported' }, 'model_unavailable'],
    [{ status: 503, text: '' }, 'server'],
  ];
  for (const [response, code] of cases) {
    const { impl } = fakeFetch([response]);
    await assert.rejects(chat({ ...base, fetchImpl: impl }), (err) => err instanceof SarvamError && err.code === code);
  }
});

test('testConnection reports a rejected model without throwing', async () => {
  const { impl } = fakeFetch([{ status: 400, text: 'Unknown model' }]);
  assert.deepEqual(await testConnection({ apiKey: 'k', model: 'sarvam-30b', fetchImpl: impl }), {
    ok: false,
    code: 'model_unavailable',
    message: 'This model is not available on your key.',
  });
});

test('parses JSON wrapped in code fences or surrounding text', () => {
  assert.deepEqual(parseJsonContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonContent('Here you go: {"a":2} done'), { a: 2 });
  assert.throws(() => parseJsonContent('no json'), (err) => err.code === 'bad_response');
});
