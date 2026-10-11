import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quoteInSegment, verifyFlags } from '../src/lib/verify.js';

const segment = 'You agree that any dispute will be resolved by binding arbitration, and you waive the right to a jury trial.';

test('accepts exact quotes regardless of case, spacing and curly quotes', () => {
  assert.equal(quoteInSegment('resolved by  BINDING arbitration', segment), true);
  assert.equal(quoteInSegment('“waive the right to a jury trial”', segment), true);
});

test('accepts quotes elided with an ellipsis when the pieces appear in order', () => {
  assert.equal(quoteInSegment('any dispute … binding arbitration', segment), true);
  assert.equal(quoteInSegment('binding arbitration ... any dispute', segment), false);
});

test('rejects paraphrases and very short quotes', () => {
  assert.equal(quoteInSegment('disputes go to arbitration', segment), false);
  assert.equal(quoteInSegment('you', segment), false);
});

test('drops bad citations, then flags left with none', () => {
  const segments = [{ id: 's1', text: segment }];
  const { flags, droppedCitations, droppedFlags } = verifyFlags(
    [
      {
        title: 'Arbitration',
        citations: [
          { segmentId: 's1', quote: 'binding arbitration' },
          { segmentId: 's9', quote: 'binding arbitration' },
        ],
      },
      { title: 'Invented', citations: [{ segmentId: 's1', quote: 'we sell your data' }] },
      { title: 'No citations' },
    ],
    segments,
  );
  assert.deepEqual(
    flags.map((f) => [f.title, f.citations.length]),
    [['Arbitration', 1]],
  );
  assert.equal(droppedCitations, 2);
  assert.equal(droppedFlags, 2);
});
