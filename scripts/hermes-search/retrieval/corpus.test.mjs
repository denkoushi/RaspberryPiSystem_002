import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDataAsOf, mergeRecords, recordFromAuthorizedRow, stampAnswer } from './corpus.mjs';

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
