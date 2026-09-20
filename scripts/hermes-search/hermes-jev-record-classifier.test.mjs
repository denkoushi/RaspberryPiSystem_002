import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AuthorizedRecordClassifier } from './hermes-jev-record-classifier.mjs';

const snapshot = {
  schema: 'hermes-qmd-snapshot/v1',
  records: [
    {
      id: 'real-1', nonconformityNo: '00010001', partNumber: 'PART-1', partName: '軸', machineName: '旋盤A',
      originDepartmentName: '機械課', discoveredOn: '2026-09-19', condition: '旋盤加工で外径が上限を超過',
      remarks: '寸法不適合', correctiveContent: '再加工を実施', disposition: '選別して隔離'
    },
    {
      id: 'real-2', nonconformityNo: '00010002', partNumber: 'PART-2', partName: '板', machineName: 'フライスB',
      originDepartmentName: '組立課', discoveredOn: '2026-09-01', condition: '側面に打痕',
      remarks: null, correctiveContent: null, disposition: '交換'
    }
  ]
};

function evaluator({ state, questions }) {
  const request = state.request;
  const answers = {};
  for (const key of Object.keys(questions)) {
    if (key === 'process') answers[key] = { type: 'choice', choice: request.includes('旋盤') ? 'turning' : request.includes('フライス') ? 'milling' : 'unknown' };
    else if (key === 'cause_status') answers[key] = { type: 'choice', choice: request.includes('原因：') ? 'cause_recorded' : request.includes('原因なし') ? 'cause_not_recorded' : 'unknown' };
    else if (key === 'treatment_status') answers[key] = { type: 'choice', choice: request.includes('再加工') || request.includes('処置') || request.includes('交換') ? 'treatment_recorded' : request.includes('処置なし') ? 'treatment_not_recorded' : 'unknown' };
    else if (key === 'phenomenon:oversize') answers[key] = { type: 'choice', choice: request.includes('上限') || request.includes('寸法') ? 'present' : 'absent' };
    else if (key === 'phenomenon:surface_damage') answers[key] = { type: 'choice', choice: request.includes('打痕') ? 'present' : 'absent' };
    else if (key === 'treatment:rework') answers[key] = { type: 'choice', choice: request.includes('再加工') ? 'present' : 'absent' };
    else if (key === 'treatment:segregate') answers[key] = { type: 'choice', choice: request.includes('隔離') ? 'present' : 'absent' };
    else if (key === 'treatment:repair_or_replace') answers[key] = { type: 'choice', choice: request.includes('交換') ? 'present' : 'absent' };
    else answers[key] = { type: 'choice', choice: 'absent' };
  }
  return Promise.resolve({ answers });
}

test('classifies real snapshot rows incrementally and refuses unbound display-only questions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-real-classifier-'));
  const snapshotPath = path.join(directory, 'snapshot.json');
  const storePath = path.join(directory, 'classifications.json');
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const first = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: evaluator });
  const firstRuntime = await first.prepare();
  assert.equal(firstRuntime.recordCount, 2);
  assert.equal(firstRuntime.classifiedRecordCount, 2);
  assert.equal(firstRuntime.reusedRecordCount, 0);
  const matched = await first.answer('旋盤加工で寸法が上限を超えた不適合の処置を確認したい。');
  assert.equal(matched.status, 'completed');
  assert.deepEqual(matched.recordIds, ['nonconformity:real-1']);
  assert.match(matched.answer, /再加工を実施/);
  const department = await first.answer('機械課の最近の不適合');
  assert.deepEqual(department.recordIds, ['nonconformity:real-1']);
  const excluded = await first.answer('機械課を除く不適合');
  assert.deepEqual(excluded.recordIds, ['nonconformity:real-2']);
  const unbound = await first.answer('発生日は');
  assert.equal(unbound.status, 'clarification');
  assert.deepEqual(unbound.recordIds, []);
  const dated = await first.answer('発生日は2026年9月19日の不適合');
  assert.deepEqual(dated.recordIds, ['nonconformity:real-1']);

  const persisted = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(persisted.records.length, 2);
  assert.equal(persisted.classifications.length, 2);
  assert.ok(!JSON.stringify(persisted.classifications).includes('旋盤加工で外径が上限を超過'));
  assert.ok(!persisted.definition.groups.find((group) => group.id === 'observed_topic').options.some((option) => option.observedTerm === 'PART'));

  const second = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: () => { throw new Error('unchanged rows must not be sent to JEV'); } });
  const secondRuntime = await second.prepare();
  assert.equal(secondRuntime.classifiedRecordCount, 0);
  assert.equal(secondRuntime.reusedRecordCount, 2);

  await writeFile(snapshotPath, JSON.stringify({
    ...snapshot,
    records: [...snapshot.records, {
      id: 'real-3', nonconformityNo: '00010003', partNumber: 'PART-3', partName: '軸受', machineName: '検査C',
      originDepartmentName: '品質保証課', discoveredOn: '2026-09-20', condition: '刻印が一部欠落',
      remarks: '識別情報の不備', correctiveContent: null, disposition: '設計へ確認依頼'
    }]
  }));
  let thirdCalls = 0;
  const third = new AuthorizedRecordClassifier({ snapshotPath, storePath, evaluateImplementation: async (input) => {
    thirdCalls += 1;
    return evaluator(input);
  } });
  const thirdRuntime = await third.prepare();
  assert.equal(thirdRuntime.classifiedRecordCount, 1);
  assert.equal(thirdRuntime.reusedRecordCount, 2);
  assert.equal(thirdCalls, 1);
});
