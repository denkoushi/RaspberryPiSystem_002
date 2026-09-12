import assert from 'node:assert/strict';

import { extractNumberedRecordAnswer } from './hermes-answer-extract.mjs';

const records = [
  {
    kind: 'nonconformity',
    id: 'synthetic-a',
    evidenceKey: 'nonconformity:synthetic-a',
    nonconformityNo: '00008204',
    partNumber: 'PN-A',
    partName: '試験品A',
    machineName: '旋盤A',
    originDepartmentCode: 'D-01',
    originDepartmentName: '機械課',
    condition: 'タップ加工されていない。',
    remarks: '備考にある文は対策ではない。',
    correctiveContent: '右側だけ再加工する。左側は加工しない。',
    disposition: '製造二課で全数を再検査する。'
  },
  {
    kind: 'nonconformity',
    id: 'synthetic-b',
    evidenceKey: 'nonconformity:synthetic-b',
    nonconformityNo: '00008205',
    partNumber: 'PN-B',
    partName: '試験品B',
    machineName: '研削盤B',
    originDepartmentCode: 'D-02',
    originDepartmentName: '品質保証課',
    condition: '傷あり。',
    remarks: '別記録の備考。',
    correctiveContent: '砥石を交換する。',
    disposition: '品質保証課で外観を確認する。'
  }
];

{
  const result = extractNumberedRecordAnswer({
    question: '不適合番号 8204 の対策を教えてください',
    records
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.intent, 'countermeasure');
  assert.deepEqual(result.requestedFields, ['correctiveContent', 'disposition']);
  assert.equal(result.requestedRecordNumbers[0], '8204');
  assert.match(result.answer, /不適合番号 00008204/u);
  assert.match(result.answer, /個別是正内容: 右側だけ再加工する。左側は加工しない。/u);
  assert.match(result.answer, /処置内容: 製造二課で全数を再検査する。/u);
  assert.doesNotMatch(result.answer, /試験品A|旋盤A|備考にある文/u);
  assert.deepEqual(result.selectedFields.map((field) => field.field), ['correctiveContent', 'disposition']);
  assert.deepEqual(result.selectedFields.map((field) => field.sourceFields), [['correctiveContent'], ['disposition']]);
}

{
  const result = extractNumberedRecordAnswer({
    question: 'No. 8204 の処置内容だけ確認したい',
    records
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.intent, 'handling');
  assert.deepEqual(result.requestedFields, ['disposition']);
  assert.match(result.answer, /処置内容: 製造二課で全数を再検査する。/u);
  assert.doesNotMatch(result.answer, /個別是正内容|右側だけ再加工/u);
}

{
  const result = extractNumberedRecordAnswer({
    question: '8205の対策',
    records: [{ ...records[1], correctiveContent: null, disposition: null }]
  });
  assert.equal(result.status, 'ready');
  assert.match(result.answer, /個別是正内容: 未記録/u);
  assert.match(result.answer, /処置内容: 未記録/u);
  assert.match(result.answer, /未実施を意味しません/u);
  assert.equal(result.missingFields.length, 2);
  assert(result.missingFields.every((field) => field.recordKey === 'nonconformity:synthetic-b'));
}

{
  const result = extractNumberedRecordAnswer({
    question: '不適合番号 8204 と 8205 の対策',
    records
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.matchedRecordNumbers, ['00008204', '00008205']);
  assert.equal((result.answer.match(/個別是正内容:/gu) ?? []).length, 2);
  assert.equal((result.answer.match(/処置内容:/gu) ?? []).length, 2);
  assert.match(result.answer, /右側だけ再加工する。左側は加工しない。/u);
  assert.match(result.answer, /砥石を交換する。/u);
  assert.match(result.answer, /製造二課で全数を再検査する。/u);
  assert.match(result.answer, /品質保証課で外観を確認する。/u);
  const firstRecordFields = result.records[0].selectedFields;
  assert(firstRecordFields.every((field) => field.recordKey === 'nonconformity:synthetic-a'));
}

{
  const result = extractNumberedRecordAnswer({
    question: '不適合番号 8204 の原因を教えてください',
    records: [records[0]]
  });
  assert.equal(result.intent, 'cause');
  assert.deepEqual(result.requestedFields, []);
  assert.deepEqual(result.selectedFields, []);
  assert.deepEqual(result.missingFields, []);
  assert.deepEqual(result.unsupportedRequests, ['cause']);
  assert.match(result.answer, /記録本文から原因の記述を選ぶことには未対応です/u);
  assert.match(result.answer, /備考や不適合内容を原因として再分類していません/u);
  assert.doesNotMatch(result.answer, /備考にある文は対策ではない|機械課/u);
}

{
  const result = extractNumberedRecordAnswer({
    question: '8204について教えてください',
    records
  });
  assert.equal(result.status, 'clarification');
  assert.match(result.answer, /対策、処置、または原因/u);
  assert.equal(result.selectedFields.length, 0);
}

{
  const result = extractNumberedRecordAnswer({
    question: '不適合番号 9999 の対策',
    records
  });
  assert.equal(result.status, 'no_match');
  assert.deepEqual(result.unmatchedRecordNumbers, ['9999']);
  assert.match(result.answer, /取得済み記録にはありません/u);
}

{
  const manyRecords = Array.from({ length: 24 }, (_, index) => ({
    ...records[1],
    id: `synthetic-filler-${index}`,
    evidenceKey: `nonconformity:synthetic-filler-${index}`,
    nonconformityNo: `00009${String(index).padStart(2, '0')}`
  }));
  manyRecords.push({
    ...records[0],
    id: 'synthetic-25th',
    evidenceKey: 'nonconformity:synthetic-25th',
    nonconformityNo: '00009999'
  });
  const result = extractNumberedRecordAnswer({
    question: '不適合番号 9999 の対策',
    records: manyRecords
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.matchedRecordNumbers, ['00009999']);
  assert.match(result.answer, /右側だけ再加工する。左側は加工しない。/u);
}

console.log(JSON.stringify({ ok: true, tests: 8 }));
