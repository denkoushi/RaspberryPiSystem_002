import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceDefinitions, sourceIdsFromEnv, validateSourceDefinition } from '../hermes-source-definition.mjs';
import { loadCatalog } from './catalog.mjs';
import { authorizedRecords } from './corpus.mjs';
import { rankCandidates } from './executor.mjs';
import { completeRequest, createRetrievalAnswering, dispatchWorkerRequest } from './worker.mjs';

const catalog = loadCatalog(['nonconformity', 'procedure_material']);
const records = authorizedRecords([
  { kind: 'procedure_material', id: 'mail:first', bodyText: 'ブラケット溶接の組立手順' },
  { kind: 'procedure_material', id: 'material:second', bodyText: '潤滑油の交換' },
  { kind: 'nonconformity', id: 'other-source', condition: 'ブラケット溶接' },
], catalog);
const request = { type: 'rank', requestId: 'r1', sourceId: 'procedure_material', q: 'ブラケット溶接', limit: 100 };
const forbidden = () => { throw new Error('planner or judge was called'); };
const answering = (dense) => createRetrievalAnswering({ catalog, records, planner: { plan: forbidden }, evaluate: forbidden,
  denseBySource: { procedure_material: dense } });

test('procedure material definition is valid and remains opt-in', () => {
  const definition = validateSourceDefinition(sourceDefinitions.procedure_material, 'procedure_material');
  assert.deepEqual(definition.retrieval, { semanticSearch: true, enrichment: false, learnedQueries: false, denseStoreSuffix: 'procedure_material' });
  assert.deepEqual(sourceIdsFromEnv({}), ['nonconformity']);
  assert.deepEqual(sourceIdsFromEnv({ HERMES_RETRIEVAL_SOURCES: 'nonconformity,procedure_material' }), ['nonconformity', 'procedure_material']);
});

test('rank bypasses planner and judge and fuses lexical and source-specific dense hits', async () => {
  const dense = { queryEnabled: true, rank: async (q, rows) => {
    assert.equal(q, request.q);
    assert.deepEqual(rows.map(row => row.id), ['mail:first', 'material:second']);
    return { ok: true, orderedIds: ['material:second', 'mail:first', 'other-source'] };
  } };
  const emitted = [];
  const result = await dispatchWorkerRequest(answering(dense), request, payload => emitted.push(payload));
  assert.deepEqual(result.result, { recordIds: ['mail:first', 'material:second'], mode: 'semantic', fallback: false });
  assert.deepEqual(emitted, [result]);
});

test('rank rejects missing or inactive source and invalid inputs', async () => {
  for (const extra of [{ sourceId: undefined }, { sourceId: 'missing' }, { q: '' }, { q: 'x'.repeat(201) }, { limit: 101 }, { allowedRecordIds: null }, { allowedRecordIds: 'mail:first' },
    { allowedRecordIds: [1] }, { allowedRecordIds: [''] }, { allowedRecordIds: Array(20001).fill('mail:first') }]) {
    assert.ok((await completeRequest(answering(), { ...request, ...extra })).workerError);
  }
  const ncOnly = createRetrievalAnswering({ catalog: loadCatalog(['nonconformity']), records: [], planner: { plan: forbidden }, evaluate: forbidden });
  assert.ok((await completeRequest(ncOnly, request)).workerError);
  await assert.rejects(rankCandidates(request.q), /sourceId/);
});

test('dense missing, disabled, empty, failed and timed out fall back silently to lexical', async () => {
  for (const dense of [undefined, { queryEnabled: false, rank: forbidden },
    { queryEnabled: true, rank: async () => ({ ok: false }) },
    { queryEnabled: true, rank: async () => ({ ok: true, orderedIds: [] }) },
    { queryEnabled: true, rank: async () => { throw new Error('offline'); } },
    { queryEnabled: true, rank: () => new Promise(() => {}) }]) {
    const result = await completeRequest(answering(dense), request);
    assert.deepEqual(result.result, { recordIds: ['mail:first'], mode: 'lexical', fallback: true });
  }
});

test('lexical no-match returns no ids and rank limit is independent of the judge pool', async () => {
  const service = answering();
  assert.deepEqual((await completeRequest(service, { ...request, q: '無関係な語句' })).result.recordIds, []);
  const many = Array.from({ length: 120 }, (_, i) => ({ id: `mail:${i}`, sourceId: 'procedure_material', bodyText: request.q }));
  const ranked = await rankCandidates(request.q, { sourceId: 'procedure_material', records: many, catalog: loadCatalog(['procedure_material']), limit: 100 });
  assert.equal(ranked.recordIds.length, 100);
});

test('allowed ids filter records before lexical and dense ranking and the result limit', async () => {
  const many = authorizedRecords([
    ...Array.from({ length: 120 }, (_, i) => ({ kind: 'procedure_material', id: `mail:placed-${i}`, bodyText: request.q })),
    { kind: 'procedure_material', id: 'mail:unplaced', bodyText: request.q },
  ], catalog);
  for (const useDense of [false, true]) {
    let denseCalled = false;
    const service = createRetrievalAnswering({ catalog, records: many, planner: { plan: forbidden }, evaluate: forbidden,
      denseBySource: { procedure_material: { queryEnabled: useDense, rank: async (q, rows) => {
        denseCalled = true;
        assert.ok(rows.length <= 1);
        if (rows.length) assert.deepEqual(rows.map(row => row.id), ['mail:unplaced']);
        return { ok: true, orderedIds: ['mail:placed-0', 'mail:unplaced'] };
      } } } });
    const result = await completeRequest(service, { ...request, allowedRecordIds: ['mail:unplaced'] });
    assert.deepEqual(result.result.recordIds, ['mail:unplaced']);
    assert.equal(denseCalled, useDense);
    assert.deepEqual((await completeRequest(service, { ...request, allowedRecordIds: [] })).result.recordIds, []);
  }
});

test('successful corpus application acknowledges configured sources even for empty records', async () => {
  const result = await answering().replaceCorpus({ mode: 'full', records: [] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.sourceIds, ['nonconformity', 'procedure_material']);
});
