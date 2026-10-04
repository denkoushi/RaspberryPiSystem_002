import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizedRecords, buildCorpusView, formatDataAsOf, mergeRecords, recordFromAuthorizedRow, replaceCorpus, stampAnswer } from './corpus.mjs';
import { loadCatalog } from './catalog.mjs';

test('one-argument authorizedRecords keeps legacy fields, empty strings and passthrough rows', () => {
  const bare = { id: 'bare', condition: 'already converted' };
  const other = { id: 'other', kind: 'work_instruction', condition: 'legacy passthrough' };
  const rows = authorizedRecords([{ id: 'n1', kind: 'nonconformity', condition: ' original ', remarks: null, secret: 'drop', partNumber: 42 }, bare, other, null, {}]);
  assert.deepEqual(rows, [{
    id: 'n1', sourceId: 'nonconformity', nonconformityNo: '', partName: '', machineName: '',
    originDepartmentName: '', discoveredOn: '', condition: ' original ', remarks: '', correctiveContent: '', disposition: '',
  }, bare, other]);
  assert.equal(rows[1], bare);
  assert.deepEqual(authorizedRecords([bare, other], undefined), [bare, other]);
  assert.deepEqual(authorizedRecords(null), []);
});

test('mixed authorized rows use only catalog fields and reject disabled or unknown kinds', () => {
  const catalog = loadCatalog(['nonconformity', 'knowledge_procedure']);
  const rows = [{ kind: 'nonconformity', id: 'same', condition: 'mark', partNumber: 'N' },
    { kind: 'knowledge_procedure', id: 'same', title: '溶接', stepsText: '手順原文', partNumber: 'P', condition: 'drop', secret: 'drop' },
    { kind: 'unknown', id: 'skip' }];
  const records = authorizedRecords(rows, catalog);
  assert.equal(records.length, 2);
  assert.equal(records[1].sourceId, 'knowledge_procedure');
  assert.equal(records[1].stepsText, '手順原文');
  assert.equal(records[1].cautionsText, '');
  assert.equal('condition' in records[1], false);
  assert.equal('secret' in records[1], false);
  assert.equal(authorizedRecords(rows, loadCatalog(['nonconformity'])).length, 1);
  const view = buildCorpusView(records, catalog, '2026-10-04');
  assert.deepEqual(view.bySource.knowledge_procedure.records, [records[1]]);
  assert.deepEqual(view.valueIndex.values.nonconformity.partNumber, ['N']);
  assert.deepEqual(view.valueIndex.values.knowledge_procedure.partNumber, ['P']);
  const refreshed = replaceCorpus(view, catalog, { mode: 'incremental', records: [rows[1]] });
  assert.equal(refreshed.snapshotCount, 2);
  const full = replaceCorpus(refreshed, catalog, { mode: 'full', records: [rows[0]] });
  assert.equal(full.bySource.knowledge_procedure.records.length, 0);
});

test('merge keeps an updated row and a new row', () => {
  const merged = mergeRecords(
    [{ id: 'a', condition: 'one' }, { id: 'b', condition: 'two' }],
    [{ id: 'a', condition: 'one-b' }, { id: 'c', condition: 'three' }],
  );
  assert.deepEqual(merged.map((row) => row.id), ['a', 'b', 'c']);
  assert.equal(merged[0].condition, 'one-b');
});

test('authorized rows keep original text fields and drop other kinds', () => {
  const row = recordFromAuthorizedRow({
    id: 'n1',
    kind: 'nonconformity',
    nonconformityNo: 'SYN-1',
    condition: 'synthetic mark',
    discoveredOn: '2024-01-01',
  });
  assert.equal(row.condition, 'synthetic mark');
  assert.equal(recordFromAuthorizedRow({ id: 'w1', kind: 'work_instruction', condition: 'skip' }), null);
});

test('data timestamp is JST minute precision', () => {
  assert.equal(formatDataAsOf('2026-09-24T00:30:00.000Z'), '2026-09-24 09:30');
  const stamped = stampAnswer('件数は1件です。', '2026-09-24T00:30:00.000Z');
  assert.equal(stamped.dataAsOf, '2026-09-24 09:30');
  assert.match(stamped.answer, /データ時点: 2026-09-24 09:30$/);
});
