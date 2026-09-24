import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countKeywordHits, percentile } from './evaluate.mjs';

test('gold example file matches the case shape and the judge counts body keywords', () => {
  const gold = JSON.parse(readFileSync(new URL('./fixtures/gold.example.json', import.meta.url), 'utf8'));
  assert.equal(gold.length, 2);
  assert.equal(gold[0].expect, 'answer');
  assert.deepEqual(gold[0].judge.anyOf, ['scratch']);
  assert.equal(gold[1].expect, 'no_result');
  const hits = countKeywordHits([
    { fields: { condition: '  surface scratch  ', remarks: '' } },
    { fields: { condition: 'paint drip', remarks: 'demo only' } },
  ], ['scratch'], ['condition', 'remarks']);
  assert.equal(hits, 1);
  assert.equal(percentile([10, 30, 20], 0.5), 20);
  assert.equal(percentile([10, 30, 20], 0.95), 30);
});
