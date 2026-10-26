import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existingRealIds, planSummary, readRealRows, readReceiptQuestions, realId, realPath } from './flywheel-real.mjs';

test('consultation route rows are not read as receipt questions', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-real-routes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const rows = [
    ...['record_search', 'operation_guide', 'trouble_report', 'handoff', 'unknown'].map((route) => ({
      at: '2026-10-14T01:00:00Z', consultationRoute: { route, guideMiss: true, direct: false, question: `相談 ${route}` }
    })),
    { at: '2026-10-14T01:01:00Z', recordIds: [], hermesReceipt: { question: '傷の記録', outcome: 'answer', plan: { semanticQuery: '傷' } } },
  ];
  writeFileSync(path.join(dir, 'receipts-2026-10-14.jsonl'), rows.map(JSON.stringify).join('\n'));
  assert.deepEqual((await readReceiptQuestions({ receiptsDir: dir, days: ['2026-10-14'] })).map((row) => row.question), ['傷の記録']);
});

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
    { id: realId('ABC 傷'), question: 'ＡＢＣ 傷', receiptAt: rows[0].at, dayOutcome: 'answer', dayShown: ['a1', 'b1'], turn: 0 },
    { id: realId('空結果'), question: '空結果', receiptAt: rows[0].at, dayOutcome: 'no_result', dayShown: ['a1', 'b1'], turn: 0 },
    { id: realId('他なし'), question: '他なし', receiptAt: rows[0].at, dayOutcome: 'no_other', dayShown: ['a1', 'b1'], turn: 0 },
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

test('receipts sharing a session replay as follow-ups with the previous plan, shown records, and earlier questions', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-real-session-'));
  const plan = (semanticQuery, filters = []) => ({ sources: ['nonconformity'], filters, semanticQuery, sort: null, limit: 5, display: ['a'] });
  const first = plan('ネジ 傷');
  const second = plan('', [{ source: 'nonconformity', field: 'originDepartmentName', op: 'in', values: ['北工場A課', '北工場B課'] }]);
  const rows = [
    // Written out of order on purpose; the night sorts a session by time.
    { at: '2026-10-26T14:55:00Z', sessionId: 's1', recordIds: ['nonconformity:c1'], hermesReceipt: { question: '北工場では類例ない？', outcome: 'answer', plan: second } },
    { at: '2026-10-26T14:53:00Z', sessionId: 's1', recordIds: ['nonconformity:a1', 'nonconformity:b1'], hermesReceipt: { question: 'ネジの傷', outcome: 'answer', plan: first } },
    // A turn that asked back is not replayed, but its plan is what the kiosk carried forward.
    { at: '2026-10-26T14:54:00Z', sessionId: 's1', recordIds: [], hermesReceipt: { question: 'えっと', outcome: 'clarification', plan: plan('ネジ 傷 えっと') } },
    { at: '2026-10-26T14:56:00Z', sessionId: 's1', recordIds: ['nonconformity:a1'], hermesReceipt: { question: '他に何件ある？', outcome: 'answer', plan: plan('', []) } },
    // A chip click echoes the question text; it is not replayed, its plan is followed, and the shown list restarts with it.
    { at: '2026-10-26T14:57:00Z', sessionId: 's1', recordIds: ['nonconformity:d1'], hermesReceipt: { question: '他に何件ある？', outcome: 'answer', plan: plan('', [{ source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: ['北工場A課'] }]), refine: { axis: 'organization', field: 'originDepartmentName', value: '北工場A課' } } },
    { at: '2026-10-26T14:58:00Z', sessionId: 's1', recordIds: [], hermesReceipt: { question: '原因は？', outcome: 'no_result', plan: plan('原因', []) } },
    // The same words in another session after a different search are another question.
    { at: '2026-10-26T15:00:00Z', sessionId: 's2', recordIds: [], hermesReceipt: { question: 'へこみ', outcome: 'answer', plan: plan('へこみ') } },
    { at: '2026-10-26T15:01:00Z', sessionId: 's2', recordIds: [], hermesReceipt: { question: '他に何件ある？', outcome: 'no_result', plan: plan('へこみ') } },
    // Without a session id a receipt is a first turn of its own.
    { at: '2026-10-26T15:02:00Z', recordIds: [], hermesReceipt: { question: '他に何件ある？', outcome: 'answer', plan: plan('他') } },
  ];
  writeFileSync(path.join(dir, 'receipts-2026-10-26.jsonl'), rows.map(JSON.stringify).join('\n') + '\n');
  const questions = await readReceiptQuestions({ receiptsDir: dir, days: ['2026-10-26'] });
  assert.deepEqual(questions.map((item) => [item.question, item.turn]), [
    ['ネジの傷', 0], ['北工場では類例ない？', 2], ['他に何件ある？', 3], ['原因は？', 5], ['へこみ', 0], ['他に何件ある？', 1], ['他に何件ある？', 0],
  ]);
  const [, factory, count, afterChip, , countAfterDent, alone] = questions;
  assert.deepEqual(afterChip.previousPlan.filters.map((filter) => filter.values), [['北工場A課']]);
  assert.deepEqual(afterChip.previousShown, ['nonconformity:d1']);
  assert.deepEqual(afterChip.context, ['ネジの傷', 'えっと', '北工場では類例ない？', '他に何件ある？']);
  assert.equal(factory.previousPlan.semanticQuery, 'ネジ 傷 えっと');
  assert.deepEqual(Object.keys(factory.previousPlan), ['sources', 'filters', 'semanticQuery', 'sort', 'limit']);
  assert.deepEqual(factory.previousShown, ['nonconformity:a1', 'nonconformity:b1']);
  assert.deepEqual(factory.context, ['ネジの傷', 'えっと']);
  assert.deepEqual(count.previousPlan, planSummary(second));
  assert.deepEqual(count.previousShown, ['nonconformity:a1', 'nonconformity:b1', 'nonconformity:c1']);
  assert.deepEqual(count.context, ['ネジの傷', 'えっと', '北工場では類例ない？']);
  assert.deepEqual(count.dayShown, ['a1']);
  assert.equal(count.id, realId('他に何件ある？', planSummary(second)));
  assert.notEqual(count.id, countAfterDent.id);
  assert.equal(alone.id, realId('他に何件ある？'));
  assert.equal('previousPlan' in alone, false);
  assert.equal(new Set(questions.map((item) => item.id)).size, questions.length);
});
