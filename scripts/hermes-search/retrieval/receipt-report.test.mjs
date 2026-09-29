import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptLines, summarizeReceipts } from './receipt-report.mjs';

const line = (at, receipt, extra = {}) => JSON.stringify({ at, sessionId: 's1', recordIds: [], ...extra, hermesReceipt: receipt });

test('the report counts outcomes and lists content misses and lost meaning-based search', () => {
  const text = [
    line('2026-09-29T00:16:00Z', { outcome: 'answer', question: 'filter only', plan: { semanticQuery: '' }, timings: { vectorStatus: 'not_requested' }, jev: { turn: 'first' } }),
    line('2026-09-29T00:17:00Z', { outcome: 'no_result', question: 'content miss', plan: { semanticQuery: 'x' }, timings: { vectorStatus: 'ok' }, jev: { turn: 'new_search' } }),
    line('2026-09-29T00:18:00Z', { outcome: 'answer', question: 'slow', plan: { semanticQuery: 'y' }, timings: { vectorStatus: 'timeout' }, jev: { turn: 'refine' } }),
    '{"torn',
  ].join('\n');
  const summary = summarizeReceipts(parseReceiptLines(text));
  assert.equal(summary.total, 3);
  assert.deepEqual(summary.outcome, { answer: 2, no_result: 1 });
  assert.deepEqual(summary.vectorStatus, { not_requested: 1, ok: 1, timeout: 1 });
  assert.deepEqual(summary.review.map((row) => row.question), ['content miss', 'slow']);
  assert.equal(summary.byDay['2026-09-29'], 3);
});
