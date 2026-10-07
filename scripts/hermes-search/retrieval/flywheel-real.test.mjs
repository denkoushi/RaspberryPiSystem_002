import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existingRealIds, readRealRows, readReceiptQuestions, realId, realPath } from './flywheel-real.mjs';

test('real ids are stable SHA-1 prefixes over trimmed NFKC questions', () => {
  assert.equal(realId('abc'), 'r-a9993e364706816a');
  assert.equal(realId(' ＡＢＣ　ｷｽﾞ '), realId('ABC キズ'));
  assert.notEqual(realId('傷'), realId('へこみ'));
});

test('receipts select content outcomes, deduplicate across days, and strip record prefixes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-real-'));
  const receipt = (question, outcome = 'answer', semanticQuery = '傷', extra = {}) => ({
    at: '2026-10-03T01:00:00Z', recordIds: ['nonconformity:a1', 'b1'],
    hermesReceipt: { question, outcome, plan: { semanticQuery } }, ...extra,
  });
  const rows = [
    receipt('ＡＢＣ 傷'), receipt('ABC 傷'), receipt('空結果', 'no_result'), receipt('他なし', 'no_other'),
    receipt('絞り込み', 'answer', ''), receipt('空白検索', 'answer', '  '), receipt('空白検索2', 'answer', null),
    receipt('  '), receipt(null), ...['clarification', 'out_of_scope', 'unavailable'].map((outcome) => receipt(outcome, outcome)),
    {}, null,
  ];
  writeFileSync(path.join(dir, 'receipts-2026-10-03.jsonl'), `${rows.map(JSON.stringify).join('\n')}\nbroken\n`);
  writeFileSync(path.join(dir, 'receipts-2026-10-02.jsonl'), `${JSON.stringify(receipt('ABC 傷', 'no_result'))}\n`);
  assert.deepEqual(await readReceiptQuestions({ receiptsDir: dir, days: ['2026-10-03', '2026-10-02', '2026-10-01'] }), [
    { id: realId('ABC 傷'), question: 'ＡＢＣ 傷', receiptAt: rows[0].at, dayOutcome: 'answer', dayShown: ['a1', 'b1'] },
    { id: realId('空結果'), question: '空結果', receiptAt: rows[0].at, dayOutcome: 'no_result', dayShown: ['a1', 'b1'] },
    { id: realId('他なし'), question: '他なし', receiptAt: rows[0].at, dayOutcome: 'no_other', dayShown: ['a1', 'b1'] },
  ]);
});

test('real rows and existing ids tolerate torn lines and only read dated real files', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-real-'));
  assert.equal(realPath(dir, '2026-10-03'), path.join(dir, 'real-2026-10-03.jsonl'));
  writeFileSync(realPath(dir, '2026-10-03'), '{"id":"r-a"}\nbroken\nnull\n{}\n');
  writeFileSync(realPath(dir, '2026-10-02'), '{"id":"r-b"}\n{"id":"r-a"}\n');
  writeFileSync(path.join(dir, 'questions-2026-10-03.jsonl'), '{"id":"synthetic"}\n');
  writeFileSync(path.join(dir, 'real-unknown.jsonl'), '{"id":"unknown"}\n');
  assert.deepEqual(await existingRealIds(dir), new Set(['r-a', 'r-b']));
  assert.deepEqual(await existingRealIds(path.join(dir, 'missing')), new Set());
  assert.deepEqual(readRealRows('\n{"id":"r-a"}\nbroken\n'), [{ id: 'r-a' }]);
});

test('filter-only receipts join the set while questions with neither content nor filters stay out', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-real-filter-'));
  const rows = [
    { at: '2026-10-06T01:00:00Z', recordIds: ['nonconformity:a1'], hermesReceipt: { question: '仙台工場FA組立課の不適合２件', outcome: 'answer', plan: { semanticQuery: '', filters: [{ field: 'originDepartmentName', op: 'eq', values: ['仙台工場FA組立課'] }], sort: 'recent', limit: 2 } } },
    { at: '2026-10-06T01:01:00Z', recordIds: [], hermesReceipt: { question: '最近の不適合を２件', outcome: 'answer', plan: { semanticQuery: '', filters: [], sort: 'recent', limit: 2 } } },
    { at: '2026-10-06T01:02:00Z', recordIds: [], hermesReceipt: { question: 'こんにちは', outcome: 'answer', plan: { semanticQuery: '', filters: [], sort: null } } },
  ];
  writeFileSync(path.join(dir, 'receipts-2026-10-06.jsonl'), rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const questions = await readReceiptQuestions({ receiptsDir: dir, days: ['2026-10-06'] });
  assert.deepEqual(questions.map((item) => item.question), ['仙台工場FA組立課の不適合２件', '最近の不適合を２件']);
});
