import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { attachEnrichment, readEnrichmentStores } from './enrichment-attach.mjs';
import { assertSnapshotIdentity, countKeywordHits, parseArgs, percentile } from './evaluate.mjs';

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

test('an enrichment store attaches summary, queries, and flattened facet tags', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'enrichment-attach-'));
  const storePath = path.join(directory, 'store.jsonl');
  writeFileSync(storePath, `${JSON.stringify({
    schema: 'hermes-retrieval-enrichment/v1',
    recordId: 'rec-1',
    summary: 'qxenrich note',
    queries: ['qxenrich ask'],
    facets: {
      phenomenon: [{ value: 'qxenrich tag', evidence: 'qx' }],
      cause: [],
      process: [],
      part: [{ value: 'qxenrich part', evidence: 'qy' }],
      treatment: [],
    },
  })}\n`);
  const attached = attachEnrichment(
    [{ id: 'rec-1' }, { id: 'rec-2' }],
    readEnrichmentStores([storePath]),
  );
  assert.deepEqual(attached[0].enrichment, {
    summary: 'qxenrich note',
    queries: ['qxenrich ask'],
    tags: ['qxenrich tag', 'qxenrich part'],
  });
  const aliased = attachEnrichment([{ id: 'rec-1' }], new Map([['rec-1', {
    schema: 'hermes-retrieval-enrichment/v1',
    recordId: 'rec-1',
    summary: 'qxenrich note',
    queries: [],
    facets: { phenomenon: [], cause: [], process: [], part: [], treatment: [] },
    aliases: [{ term: 'qxterm', alts: ['qxalt'] }],
  }]]));
  assert.deepEqual(aliased[0].enrichment.tags, ['qxterm', 'qxalt']);
  assert.equal(attached[1].enrichment, undefined);

  const args = parseArgs(['--gold', 'g', '--snapshot', 's', '--enrichment', storePath, '--enrichment', 'a.jsonl,b.jsonl', '--out', 'o']);
  assert.deepEqual(args.enrichment, [storePath, 'a.jsonl', 'b.jsonl']);
  assert.equal(args.noEnrichment, false);
  const off = parseArgs(['--gold', 'g', '--snapshot', 's', '--enrichment', storePath, '--no-enrichment', '--out', 'o']);
  assert.equal(off.noEnrichment, true);
});

test('a subset snapshot skips only the digest and recordCount check', () => {
  const records = [{ id: 'rec-1' }];
  const subset = { records, recordCount: 99, digest: 'a'.repeat(64) };
  assert.throws(() => assertSnapshotIdentity(subset), /recordCount/);
  const args = parseArgs(['--gold', 'g', '--snapshot', 's', '--allow-subset', '--out', 'o']);
  assert.equal(args.allowSubset, true);
  assert.doesNotThrow(() => {
    if (!args.allowSubset) assertSnapshotIdentity(subset);
  });
});
