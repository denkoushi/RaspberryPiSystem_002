import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReport, nightOfFile, readNightRows, summarizeNight } from './flywheel-report.mjs';

const live = (loss, extra = {}) => ({ outcome: loss == null ? 'answer' : 'no_result', shown: [], candidates: [], judged: 30, loss, vectorStatus: 'ok', ms: 10, ...extra });
const rows = [
  { a: 'a1', b: 'b1', seed: { style: 'terse' }, question: 'キズ 傷', kept: true, reason: null, live: live(null) },
  { a: 'a2', b: 'b2', seed: { style: 'terse' }, question: 'テーブルの傷', kept: true, reason: null, live: live('not_in_pool', { vectorStatus: 'timeout' }) },
  { a: 'a3', b: 'b3', seed: { style: 'colloquial' }, question: 'テーブルに傷ついたことある？', kept: true, reason: null, live: live('judge_rejected') },
  { a: 'a4', b: 'b4', seed: { style: 'kana' }, question: 'きず', kept: true, reason: null, live: live('status', { outcome: 'clarification' }) },
  { a: 'a5', b: 'b5', seed: { style: 'terse' }, question: '塗装 はがれ', kept: true, reason: null, live: live('other_shown', { outcome: 'answer' }) },
  { a: 'a6', b: 'b6', seed: { style: 'terse' }, question: '昨夜の質問', kept: true, reason: null },
  { a: 'a7', b: 'b7', seed: { style: 'terse' }, question: 'そのまま写した文', kept: false, reason: 'copied_run' },
  { a: 'a8', b: 'b8', seed: { style: 'typo' }, question: null, kept: false, reason: 'ungraded' },
];

test('a night summary counts generation, keep decisions, and live loss stages', () => {
  const summary = summarizeNight(rows);
  assert.equal(summary.generated, 7);
  assert.equal(summary.kept, 6);
  assert.deepEqual(summary.dropped, { copied_run: 1, ungraded: 1 });
  assert.deepEqual(summary.styles, { terse: 4, colloquial: 1, kana: 1 });
  assert.equal(summary.medianLength, 6);
  assert.deepEqual(summary.live, { scored: 5, shown: 1, otherShown: 1, notInPool: 1, judgeRejected: 1, status: 1, failed: 0, notRun: 1, denseFallbacks: 1 });
});

test('the report prints the night in one block and names the file night', () => {
  const text = formatReport('2026-10-03', summarizeNight(rows));
  assert.match(text, /^night 2026-10-03: pairs 8, generated 7, kept 6 \(median 6 chars\)/u);
  assert.match(text, /dropped: copied_run 1, ungraded 1/u);
  assert.match(text, /live \(5 scored\): relevant shown 1, other records shown 1, nothing shown 3 \(outside judged candidates 1, rejected by judge 1, asked back or out of scope 1\), not run 1/u);
  assert.match(text, /dense fallbacks: 1/u);
  assert.equal(nightOfFile('/tmp/x/questions-2026-10-03.jsonl'), '2026-10-03');
  assert.equal(readNightRows('{"a":1}\nbroken\n\n{"a":2}\n').length, 2);
  const unscored = formatReport('2026-10-02', summarizeNight(rows.filter((row) => !row.live)));
  assert.match(unscored, /live: not run for 1 kept questions/u);
});
