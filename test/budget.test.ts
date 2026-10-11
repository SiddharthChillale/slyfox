import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_CHARS, budgetMessage, checkBudget, estimateTokens, tokenRoom } from '../src/lib/budget.ts';

test('estimates Latin text at about 4 characters per token', () => {
  assert.equal(estimateTokens('a'.repeat(4000)), 1000);
});

test('counts Indic script more densely than Latin', () => {
  const hindi = 'शर्तें'.repeat(100);
  assert.ok(estimateTokens(hindi) > Math.ceil(hindi.length / 4));
});

test('refuses short extractions as missing terms', () => {
  const result = checkBudget('Accept', { model: 'sarvam-105b', reasoning: 'low' });
  assert.ok(!result.ok);
  assert.equal(result.code, 'no_terms');
});

test('refuses documents over the character limit', () => {
  const result = checkBudget('a'.repeat(MAX_CHARS + 1), { model: 'sarvam-105b', reasoning: 'low' });
  assert.ok(!result.ok);
  assert.equal(result.code, 'too_long');
  assert.match(budgetMessage(result, { model: 'sarvam-105b' }), /100,001 characters, limit 100,000/);
});

test('a maximum-length English document fits both models at High reasoning', () => {
  const text = 'word '.repeat(MAX_CHARS / 5);
  assert.equal(checkBudget(text, { model: 'sarvam-105b', reasoning: 'high' }).ok, true);
  assert.equal(checkBudget(text, { model: 'sarvam-30b', reasoning: 'high' }).ok, true);
});

test('dense scripts can exceed the smaller model before the character limit', () => {
  const text = 'शर्त'.repeat(20_000);
  assert.ok(text.length <= MAX_CHARS);
  const result = checkBudget(text, { model: 'sarvam-30b', reasoning: 'high' });
  assert.ok(!result.ok && result.code === 'too_many_tokens');
  assert.equal(result.limit, tokenRoom('sarvam-30b', 'high'));
});
