import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNonconformityCatalog } from './catalog.mjs';
import { execute, fuseRankings, RRF_K } from './executor.mjs';
import { records } from './fixtures/synthetic-records.mjs';
import { QUERY_PLAN_SCHEMA } from './query-plan.mjs';

const catalog = loadNonconformityCatalog();
const display = ['nonconformityNo', 'originDepartmentName', 'discoveredOn', 'condition', 'remarks', 'correctiveContent', 'disposition'];

function plan(overrides = {}) {
  return {
    schema: QUERY_PLAN_SCHEMA,
    sources: ['nonconformity'],
    filters: [],
    semanticQuery: '',
    sort: 'relevance',
    limit: 5,
    display,
    unresolved: [],
    ...overrides,
  };
}

test('executor filters, sorts, limits, and returns original field text', async () => {
  const executed = await execute(plan({
    filters: [{ source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: ['North Shop'] }],
    sort: { field: 'discoveredOn', direction: 'desc' },
    limit: 2,
  }), { records, catalog });
  assert.equal(executed.status, 'answer');
  assert.deepEqual(executed.results.map((result) => result.recordId), ['rec-beta', 'rec-delta']);
  assert.equal(executed.results[0].sourceId, 'nonconformity');
  const alpha = records[0];
  const semantic = await execute(plan({
    semanticQuery: 'surface scratch',
    sort: 'relevance',
    limit: 1,
  }), { records, catalog });
  assert.deepEqual(semantic.results.map((result) => result.recordId), ['rec-alpha']);
  assert.equal(semantic.results[0].fields.condition, alpha.condition);
  assert.equal(semantic.results[0].fields.condition, '  surface scratch  ');
  assert.equal(semantic.timings.vectorStatus, 'skipped');
});

test('executor reports no_result when nothing matches', async () => {
  const missing = await execute(plan({
    filters: [{ source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: ['Missing Shop'] }],
  }), { records, catalog });
  assert.equal(missing.status, 'no_result');
  assert.deepEqual(missing.results, []);

  const semantic = await execute(plan({ semanticQuery: 'qqqqxxxxx' }), { records, catalog });
  assert.equal(semantic.status, 'no_result');
});

test('date and exclusion filters keep unmatched original text out of the answer', async () => {
  const before = await execute(plan({
    filters: [{ source: 'nonconformity', field: 'discoveredOn', op: 'before', values: ['2024-06-01'] }],
    sort: { field: 'discoveredOn', direction: 'asc' },
    limit: 10,
  }), { records, catalog });
  assert.deepEqual(before.results.map((result) => result.recordId), ['rec-alpha', 'rec-gamma']);

  const excluded = await execute(plan({
    filters: [{ source: 'nonconformity', field: 'originDepartmentName', op: 'not_in', values: ['North Shop'] }],
  }), { records, catalog });
  assert.deepEqual(excluded.results.map((result) => result.recordId), ['rec-gamma']);
  assert.equal(excluded.results[0].fields.condition, 'gap too wide');
});

test('date sort keeps older relevant records ahead of newer weak matches', async () => {
  const dated = [
    {
      id: 'old-relevant',
      discoveredOn: '2020-01-01',
      condition: 'relevantphrase found on the fixture',
      remarks: '',
      correctiveContent: '',
      disposition: '',
    },
    {
      id: 'new-weak',
      discoveredOn: '2024-12-31',
      condition: 'qqqqxxxx only',
      remarks: '',
      correctiveContent: '',
      disposition: '',
    },
  ];
  const executed = await execute(plan({
    semanticQuery: 'relevantphrase',
    sort: { field: 'discoveredOn', direction: 'desc' },
    limit: 1,
    display: ['condition', 'discoveredOn'],
  }), { records: dated, bodyFields: ['condition', 'remarks', 'correctiveContent', 'disposition'] });
  assert.equal(executed.status, 'answer');
  assert.deepEqual(executed.results.map((result) => result.recordId), ['old-relevant']);
  assert.equal(executed.results[0].fields.condition, 'relevantphrase found on the fixture');
});

test('a rare content term outranks a frequent generic term', async () => {
  const body = ['condition', 'remarks', 'correctiveContent', 'disposition'];
  const dated = [];
  for (let index = 0; index < 24; index += 1) {
    dated.push({
      id: `common-${index}`,
      discoveredOn: '2024-12-01',
      condition: 'qqqqcommon filler',
      remarks: '',
      correctiveContent: '',
      disposition: '',
    });
  }
  dated.push({
    id: 'rare-hit',
    discoveredOn: '2020-01-01',
    condition: 'zzzzrare marker',
    remarks: '',
    correctiveContent: '',
    disposition: '',
  });
  const executed = await execute(plan({
    semanticQuery: 'zzzzrareのqqqqcommon',
    sort: 'relevance',
    limit: 1,
    display: ['condition'],
  }), { records: dated, bodyFields: body });
  assert.equal(executed.status, 'answer');
  assert.deepEqual(executed.results.map((result) => result.recordId), ['rare-hit']);
});

test('a single kanji or katakana character matches as its own token', async () => {
  const body = ['condition', 'remarks', 'correctiveContent', 'disposition'];
  const dated = [];
  for (let index = 0; index < 12; index += 1) {
    dated.push({
      id: `plain-${index}`,
      discoveredOn: '2024-12-01',
      condition: 'qqqqcommon filler',
      remarks: '',
      correctiveContent: '',
      disposition: '',
    });
  }
  dated.push({
    id: 'kanji-hit',
    discoveredOn: '2020-01-01',
    condition: 'mark 禾 only',
    remarks: '',
    correctiveContent: '',
    disposition: '',
  });
  dated.push({
    id: 'kana-hit',
    discoveredOn: '2021-01-01',
    condition: 'mark ヰ only',
    remarks: '',
    correctiveContent: '',
    disposition: '',
  });
  const kanji = await execute(plan({
    semanticQuery: '禾',
    sort: { field: 'discoveredOn', direction: 'desc' },
    limit: 3,
    display: ['condition'],
  }), { records: dated, bodyFields: body });
  assert.equal(kanji.status, 'answer');
  assert.deepEqual(kanji.results.map((result) => result.recordId), ['kanji-hit']);
  assert.equal(kanji.insufficient, true);
  assert.equal(kanji.requested, 3);
  assert.equal(kanji.returned, 1);

  const kana = await execute(plan({
    semanticQuery: 'ヰ',
    limit: 3,
    display: ['condition'],
  }), { records: dated, bodyFields: body });
  assert.deepEqual(kana.results.map((result) => result.recordId), ['kana-hit']);
});

test('fuseRankings keeps a lexical hit or a vector rank of 20 and caps the list', () => {
  assert.equal(RRF_K, 60);
  const lexical = [{ id: 'lexical-hit', contentTokenScore: 1 }];
  const vector = [];
  for (let index = 0; index < 21; index += 1) vector.push({ id: `vec-${index}` });
  const fused = fuseRankings(lexical, vector);
  const ids = new Set(fused.map((item) => item.id));
  assert.equal(ids.has('lexical-hit'), true);
  assert.equal(ids.has('vec-0'), true);
  assert.equal(ids.has('vec-20'), false);
  assert.ok(fused.length <= 15);
});

test('a failed vector ranker leaves the lexical order in place', async () => {
  const executed = await execute(plan({
    semanticQuery: 'surface scratch',
    sort: 'relevance',
    limit: 1,
  }), {
    records,
    catalog,
    vector: async () => { throw new Error('vector unavailable'); },
  });
  assert.equal(executed.status, 'answer');
  assert.deepEqual(executed.results.map((result) => result.recordId), ['rec-alpha']);
  assert.equal(executed.timings.vectorStatus, 'failed');
  assert.match(executed.timings.vectorReason, /vector unavailable/);
  assert.equal(executed.results[0].fields.condition, '  surface scratch  ');
});
