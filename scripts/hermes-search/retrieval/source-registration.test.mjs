import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSourceDefinitions, sourceDefinitions } from '../hermes-source-definition.mjs';
import { loadCatalog } from './catalog.mjs';
import { authorizedRecords } from './corpus.mjs';
import { buildValueIndex } from './value-index.mjs';
import { createRetrievalAnswering } from './worker.mjs';
import { createPlanner } from './planner-jev.mjs';

function register(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-synthetic-source-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const id of ['synthetic_public', 'synthetic_admin']) {
    writeFileSync(join(dir, `${id.replaceAll('_', '-')}.json`), JSON.stringify({
      schema: 'hermes-source-definition/v1', id, label: id,
      visibility: id.endsWith('admin') ? ['admin'] : ['kiosk', 'viewer', 'manager', 'admin'],
      metadataFields: { assetCode: '資産コード', count: '件数' }, bodyFields: { text: '合成記録' },
      contextAttributes: ['assetCode'], searchMetadataFields: ['assetCode'], lexicalFields: ['assetCode', 'text'],
      organizedLabels: { record: '合成記録' }, organizedContextClasses: ['record'], numericFields: ['count'],
      pageContextAttributes: { assetReference: 'assetCode', screenRecordId: null },
      retrieval: { semanticSearch: true, enrichment: true, learnedQueries: true },
      outOfScopeAnswer: '合成ソースの対象外です。',
    }));
  }
  return loadSourceDefinitions(dir);
}

const evaluate = async (input) => {
  const answers = {};
  for (const key of Object.keys(input.questions)) {
    if (key.startsWith('candidate_')) answers[key] = { type: 'noul', noul: 0.95 };
    else if (key.startsWith('field_')) answers[key] = { type: 'choice', choice: 'none' };
  }
  answers.scope = { type: 'choice', choice: 'synthetic_public' };
  answers.content = { type: 'noul', noul: 0.95 };
  answers.sort = { type: 'choice', choice: 'relevance' };
  answers.limit = { type: 'choice', choice: 'unspecified' };
  return { answers };
};

test('directory registration alone adds synthetic sources to the catalog, visibility and cross-source answers', async (t) => {
  const registered = register(t);
  const catalog = loadCatalog(['nonconformity', ...Object.keys(registered)], { ...sourceDefinitions, ...registered });
  const records = authorizedRecords([
    { kind: 'nonconformity', id: 'same', nonconformityNo: 'N1', condition: '合成横断対象' },
    ...Object.keys(registered).map(kind => ({ kind, id: 'same', assetCode: kind, count: '83.3', text: '合成横断対象' })),
  ], catalog);
  const index = buildValueIndex(records, catalog);
  assert.equal(Object.hasOwn(index.values.synthetic_public, 'count'), false);
  const inputs = [];
  const answering = createRetrievalAnswering({ records, catalog, evaluate,
    planner: { plan: async (input) => {
      inputs.push(input);
      return { plan: { schema: 'hermes-query-plan/v1', sources: input.catalog.map(entry => entry.id),
        filters: [], semanticQuery: '合成横断対象', sort: 'relevance', limit: 5,
        display: input.catalog.flatMap(entry => entry.fields.map(field => field.key)), unresolved: [] } };
    } },
  });
  const kiosk = await answering.answer('合成横断対象', null, { principal: { kind: 'kiosk' } });
  assert.deepEqual(kiosk.recordIds, ['nonconformity:same', 'synthetic_public:same']);
  assert.doesNotMatch(JSON.stringify(inputs), /synthetic_admin/);
  const admin = await answering.answer('合成横断対象', null, { principal: { kind: 'admin' } });
  assert.deepEqual(admin.recordIds, ['nonconformity:same', 'synthetic_admin:same', 'synthetic_public:same']);
  assert.match(admin.answer, /合成記録: 合成横断対象/);
});

test('synthetic policy controls screen identifiers, semantic search, learned queries and out-of-scope wording', async (t) => {
  const definitions = register(t);
  const catalog = loadCatalog(['synthetic_public'], definitions);
  const records = authorizedRecords([{ kind: 'synthetic_public', id: 'record', assetCode: 'ASSET-1', text: '合成横断対象' }], catalog);
  const planner = createPlanner({ evaluate });
  for (const [kind, filters] of [['assetReference', [{ source: 'synthetic_public', field: 'assetCode', op: 'eq', values: ['ASSET-1'] }]], ['screenRecordId', []]]) {
    const planned = await planner.plan({ question: 'この記録の合成横断対象', catalog,
      valueIndex: buildValueIndex(records, catalog), pageContext: { entity: { kind, value: 'ASSET-1' } } });
    assert.deepEqual(planned.plan.sources, ['synthetic_public']);
    assert.deepEqual(planned.plan.filters, filters);
    assert.equal(planned.receipt.pageContext.used, true);
  }
  let semanticRecords;
  const answering = createRetrievalAnswering({ records, catalog, evaluate,
    enrichmentById: new Map([['record', { summary: '合成要約', facets: { process: [{ value: '合成タグ' }] }, queries: ['追加検索語'] }]]),
    learnedById: new Map([['record', ['学習済み合成質問']]]),
    denseBySource: { synthetic_public: { queryEnabled: true, rank: async (_query, filtered) => {
      semanticRecords = filtered;
      return { ok: true, status: 'ok', orderedIds: filtered.map(row => row.id), cosines: new Map([['record', 0.9]]) };
    } } },
  });
  const result = await answering.answer('学習済み合成質問', null, { stageDump: true });
  assert.deepEqual(result.recordIds, ['synthetic_public:record']);
  assert.equal(result.receipt.retriever, 'hybrid');
  assert.deepEqual(semanticRecords[0].enrichment, { summary: '合成要約', tags: ['合成タグ'], queries: ['追加検索語', '学習済み合成質問'] });
  const outside = createRetrievalAnswering({ records, catalog,
    planner: { plan: async () => ({ plan: { sources: [], filters: [], diagnostics: { scope: 'out_of_scope' } } }) },
  });
  assert.equal((await outside.answer('天気')).answer, '合成ソースの対象外です。');
});

test('absent capabilities keep new sources lexical and do not apply learned-query wording', async (t) => {
  const definitions = register(t);
  const catalog = loadCatalog(['synthetic_public'], {
    synthetic_public: { ...definitions.synthetic_public, retrieval: undefined },
  });
  const records = authorizedRecords([
    { kind: 'synthetic_public', id: 'first', text: '合成横断対象' },
    { kind: 'synthetic_public', id: 'second', text: '合成横断対象' },
  ], catalog);
  const answering = createRetrievalAnswering({ records, catalog, evaluate,
    enrichmentById: new Map([['second', { summary: '合成要約', queries: ['合成横断対象'] }]]),
    learnedById: new Map([['second', ['合成横断対象'.repeat(10)]]]),
    dense: { queryEnabled: true, rank: () => { throw new Error('semantic search is not declared'); } },
    vector: () => { throw new Error('vector search is not declared'); },
  });
  const result = await answering.answer('合成横断対象', null, { stageDump: true });
  assert.deepEqual(result.candidateIds, ['first', 'second']);
  assert.deepEqual(result.recordIds, ['synthetic_public:first', 'synthetic_public:second']);
  assert.equal(result.receipt.retriever, 'lexical');
});
