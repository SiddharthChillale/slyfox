import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Trace, exportTrace, hostPermission, normalizeHost, testLangfuse, usageDetails } from '../src/lib/langfuse.ts';
import { analyze } from '../src/lib/pipeline.ts';
import { call, completion, fakeFetch } from './helpers.ts';

const settings: Settings = { apiKey: 'k', model: 'sarvam-105b', reasoning: 'low' };
const config: LangfuseSettings = {
  enabled: true,
  host: 'https://cloud.langfuse.com',
  publicKey: 'pk-lf-test',
  secretKey: 'sk-lf-test',
  captureContent: true,
};

const segments: Segment[] = [
  { id: 's1', text: 'The service is provided as described in these terms. '.repeat(12) },
  { id: 's2', text: 'Your subscription renews automatically each year. Email legal-team@example.com.' },
];

const analysis = {
  summary: ['You pay yearly.'],
  flags: [
    {
      category: 'auto_renewal',
      severity: 'high',
      title: 'Renews every year',
      explanation: 'You are charged again unless you cancel.',
      citations: [{ segmentId: 's2', quote: 'renews automatically each year' }],
    },
  ],
};

type OtlpSpan = ReturnType<Trace['toOtlp']>['resourceSpans'][number]['scopeSpans'][number]['spans'][number];

const spansOf = (trace: Trace, captureContent = true) =>
  trace.toOtlp({ captureContent }).resourceSpans[0]!.scopeSpans[0]!.spans;

function attr(span: OtlpSpan, key: string): unknown {
  const found = span.attributes.find((a) => a.key === key)?.value;
  if (!found) return undefined;
  return Object.values(found)[0];
}

function byName(spans: OtlpSpan[], name: string): OtlpSpan {
  const found = spans.find((s) => s.name === name);
  assert.ok(found, `no span named ${name}`);
  return found;
}

async function tracedRun() {
  const usage = { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 };
  const { impl } = fakeFetch([
    completion({ injection_detected: false, evidence: '' }),
    { json: { ...completion(analysis).json as object, usage } },
  ]);
  const trace = new Trace('analyze-terms', { release: '0.1.0', tags: ['slyfox'], metadata: { model: 'sarvam-105b' } });
  const result = await analyze({ segments, settings, fetchImpl: impl, trace: trace.root });
  trace.root.end({ output: result });
  return trace;
}

test('records one span per pipeline step, nested under the root', async () => {
  const spans = spansOf(await tracedRun());
  const root = byName(spans, 'analyze-terms');

  assert.deepEqual(
    spans.map((s) => s.name),
    ['analyze-terms', 'scrub-pii', 'injection-screen', 'terms-analysis', 'verify-citations'],
  );
  for (const span of spans) {
    assert.equal(span.traceId, root.traceId);
    assert.match(span.traceId, /^[0-9a-f]{32}$/);
    assert.match(span.spanId, /^[0-9a-f]{16}$/);
    if (span !== root) assert.equal(span.parentSpanId, root.spanId);
    assert.ok(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano));
  }
  assert.equal(attr(root, 'langfuse.trace.name'), 'analyze-terms');
  assert.equal(attr(root, 'langfuse.release'), '0.1.0');
  assert.equal(attr(root, 'langfuse.trace.metadata.model'), 'sarvam-105b');
  assert.equal(attr(byName(spans, 'scrub-pii'), 'langfuse.observation.metadata.redactions'), '1');
  assert.equal(attr(byName(spans, 'verify-citations'), 'langfuse.observation.metadata.flags'), '1');
});

test('records Sarvam calls as generations with model, parameters and usage', async () => {
  const spans = spansOf(await tracedRun());
  const screen = byName(spans, 'injection-screen');
  const main = byName(spans, 'terms-analysis');

  assert.equal(attr(main, 'langfuse.observation.type'), 'generation');
  assert.equal(attr(main, 'langfuse.observation.model.name'), 'sarvam-105b');
  assert.deepEqual(JSON.parse(attr(main, 'langfuse.observation.model.parameters') as string), {
    max_tokens: 16384,
    reasoning_effort: 'low',
    response_format: 'terms_analysis',
  });
  assert.deepEqual(JSON.parse(attr(main, 'langfuse.observation.usage_details') as string), {
    input: 900,
    output: 120,
    total: 1020,
  });
  assert.equal(attr(screen, 'langfuse.observation.usage_details'), undefined);
  assert.match(attr(main, 'langfuse.observation.output') as string, /Renews every year/);
});

test('traces only scrubbed text, and no content at all when content capture is off', async () => {
  const trace = await tracedRun();
  const withContent = JSON.stringify(trace.toOtlp({ captureContent: true }));
  assert.doesNotMatch(withContent, /legal-team@example\.com/);
  assert.match(withContent, /renews automatically each year/);

  const withoutContent = spansOf(trace, false);
  for (const span of withoutContent) {
    assert.equal(attr(span, 'langfuse.observation.input'), undefined);
    assert.equal(attr(span, 'langfuse.observation.output'), undefined);
  }
  assert.doesNotMatch(JSON.stringify(withoutContent), /renews automatically/);
  // Counts and usage still go through.
  assert.ok(attr(byName(withoutContent, 'terms-analysis'), 'langfuse.observation.usage_details'));
});

test('marks a failed Sarvam call as an error generation', async () => {
  const { impl } = fakeFetch([completion({ injection_detected: false, evidence: '' }), { status: 401, text: 'nope' }]);
  const trace = new Trace('analyze-terms');
  const result = await analyze({ segments, settings, fetchImpl: impl, trace: trace.root });
  assert.equal(result.status, 'error');

  const main = byName(spansOf(trace), 'terms-analysis');
  assert.equal(attr(main, 'langfuse.observation.level'), 'ERROR');
  assert.equal(attr(main, 'langfuse.observation.status_message'), 'Sarvam rejected the API key.');
  assert.equal(attr(main, 'langfuse.observation.metadata.code'), 'bad_key');
  assert.equal(main.status.code, 2);
});

test('exports to the OTLP endpoint with basic auth', async () => {
  const trace = new Trace('analyze-terms');
  trace.root.end();
  const { impl, calls } = fakeFetch([{ json: {} }]);
  await exportTrace(trace, config, impl);

  const sent = call(calls, 0);
  assert.equal(sent.url, 'https://cloud.langfuse.com/api/public/otel/v1/traces');
  assert.equal(sent.headers.authorization, `Basic ${btoa('pk-lf-test:sk-lf-test')}`);
  assert.equal(sent.headers['x-langfuse-ingestion-version'], '4');
  assert.ok(Array.isArray(sent.body.resourceSpans));
});

test('a rejected export throws so the caller can log it', async () => {
  const trace = new Trace('analyze-terms');
  const { impl } = fakeFetch([{ status: 401, text: 'Invalid credentials' }]);
  await assert.rejects(exportTrace(trace, config, impl), /HTTP 401 Invalid credentials/);
});

test('testLangfuse names the project, or explains why it failed', async () => {
  const ok = fakeFetch([{ json: { data: [{ id: 'p1', name: 'slyfox-dev' }] } }]);
  assert.deepEqual(await testLangfuse(config, ok.impl), { ok: true, project: 'slyfox-dev' });
  assert.equal(call(ok.calls, 0).url, 'https://cloud.langfuse.com/api/public/projects');

  const denied = fakeFetch([{ status: 401, text: '' }]);
  assert.deepEqual(await testLangfuse(config, denied.impl), {
    ok: false,
    message: 'Langfuse rejected the public or secret key.',
  });

  const offline = fakeFetch([new TypeError('Failed to fetch')]);
  const result = await testLangfuse(config, offline.impl);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.message, /Could not reach https:\/\/cloud\.langfuse\.com/);
});

test('normalizeHost accepts https, and http only on this machine', () => {
  assert.equal(normalizeHost(''), 'https://cloud.langfuse.com');
  assert.equal(normalizeHost(' https://us.cloud.langfuse.com/ '), 'https://us.cloud.langfuse.com');
  assert.equal(normalizeHost('https://example.com/langfuse/'), 'https://example.com/langfuse');
  assert.equal(normalizeHost('http://localhost:3000'), 'http://localhost:3000');
  assert.equal(normalizeHost('http://langfuse.example.com'), null);
  assert.equal(normalizeHost('not a url'), null);

  assert.equal(hostPermission('http://localhost:3000'), 'http://localhost/*');
  assert.equal(hostPermission('https://example.com/langfuse'), 'https://example.com/*');
});

test('usageDetails maps OpenAI-style usage and ignores the rest', () => {
  assert.deepEqual(usageDetails({ prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }), {
    input: 3,
    output: 4,
    total: 7,
  });
  assert.equal(usageDetails(null), undefined);
  assert.equal(usageDetails({ something: 'else' }), undefined);
});
