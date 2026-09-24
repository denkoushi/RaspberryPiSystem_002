import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evenIndexes, localSettings, structuralSample } from './enrichment-cli.mjs';
import { countKeywordHits, parseArgs, percentile } from './evaluate.mjs';

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
  assert.deepEqual(evenIndexes(10, 4), [0, 2, 5, 7]);
  const args = parseArgs(['--gold', 'g', '--snapshot', 's', '--enrichment', '/private/enrichment.jsonl', '--out', 'o']);
  assert.equal(args.enrichment, '/private/enrichment.jsonl');
  const settings = localSettings({
    baseUrl: 'http://127.0.0.1:8080/v1',
    model: 'local-model',
    maxRecords: 100,
    concurrency: 1,
  });
  assert.equal(settings.model, 'local-model');
  assert.equal(settings.profile, 'local-model');
  assert.equal(settings.origin, 'http://127.0.0.1:8080');
  const sample = structuralSample({
    summary: 'abcd',
    queries: ['aa', 'bbb'],
    facets: { phenomenon: [{}], cause: [], process: [], part: [{}, {}], treatment: [] },
  });
  assert.deepEqual(sample, {
    summaryChars: 4,
    queryCount: 2,
    queryChars: [2, 3],
    facetCounts: { phenomenon: 1, cause: 0, process: 0, part: 2, treatment: 0 },
    tagCount: 0,
  });
});
