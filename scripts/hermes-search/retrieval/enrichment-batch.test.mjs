import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { evenBatchIndexes, parsePrepArgs, slimRecord, writePrepBatch } from './enrichment-batch-prep.mjs';
import { ingestEnrichment } from './enrichment-ingest.mjs';
import { readEnrichmentStore } from './enrichment-store.mjs';

test('prep selects a range and ingest keeps only evidence found in the record', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'enrich-batch-'));
  const snapshot = path.join(directory, 'snapshot.json');
  const prep = path.join(directory, 'batch.json');
  const store = path.join(directory, 'store.jsonl');
  const instructions = path.join(directory, 'instructions.md');
  const records = [
    { id: 'rec-alpha', kind: 'nonconformity', partName: 'Demo Widget', machineName: 'Lathe-1', condition: 'surface scratch', remarks: '', correctiveContent: '', disposition: 'reworked' },
    { id: 'rec-beta', kind: 'nonconformity', partName: 'Demo Bracket', machineName: 'Lathe-1', condition: 'paint drip', remarks: '', correctiveContent: '', disposition: 'accepted' },
  ];
  await writeFile(snapshot, JSON.stringify({ records }));
  await writeFile(instructions, 'instruction text\n');
  assert.deepEqual(evenBatchIndexes(10, 4, 1, 2), [5, 7]);
  const written = await writePrepBatch({ snapshotPath: snapshot, indexes: [0], outPath: prep });
  assert.equal(written.records, 1);
  assert.equal(slimRecord(records[0], ['condition']).condition, 'surface scratch');
  const args = parsePrepArgs(['--snapshot', snapshot, '--start', '0', '--count', '1', '--out', prep]);
  assert.equal(args.start, 0);
  await writeFile(path.join(directory, 'out.json'), JSON.stringify({
    records: [
      {
        id: 'rec-alpha',
        facets: {
          phenomenon: [{ value: 'scratch', evidence: 'surface scratch' }],
          cause: [{ value: 'invented', evidence: 'not-in-source' }],
          process: [],
          part: [],
          treatment: [],
        },
        queries: ['widget scratch?', 'lathe mark?', 'rework record?'],
        summary: 'demo scratch',
      },
      { id: 'missing', facets: {}, queries: [], summary: '' },
    ],
  }));
  const counts = await ingestEnrichment({
    inputPath: path.join(directory, 'out.json'),
    snapshotPath: snapshot,
    storePath: store,
    instructionsPath: instructions,
  });
  assert.deepEqual(counts, { examined: 2, kept: 1, evidenceDropped: 1, aliasesDropped: 0, aliasesKept: 0, invalid: 1 });
  const stored = await readEnrichmentStore(store);
  assert.equal(stored.get('rec-alpha').profile, 'grok-4.7-high-fast (offline experiment)');
  assert.equal(stored.get('rec-alpha').facets.cause.length, 0);
  assert.equal(stored.get('rec-alpha').facets.phenomenon.length, 1);
});


test('offline enrichment prep and ingest exclude rank-only records', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'enrich-rank-only-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const inputPath = path.join(directory, 'input.json');
  const instructionsPath = path.join(directory, 'instructions.md');
  const storePath = path.join(directory, 'store.jsonl');
  await writeFile(snapshotPath, JSON.stringify({ records: [{ id: 'material', sourceId: 'procedure_material', bodyText: 'private' }] }));
  await assert.rejects(writePrepBatch({ snapshotPath, indexes: [0], outPath: inputPath }), /non-conversational/);
  await writeFile(inputPath, JSON.stringify({ records: [{ id: 'material' }] }));
  await writeFile(instructionsPath, 'test');
  const result = await ingestEnrichment({ snapshotPath, inputPath, instructionsPath, storePath });
  assert.equal(result.kept, 0);
  assert.equal(result.invalid, 1);
  assert.equal((await readEnrichmentStore(storePath)).size, 0);
});
