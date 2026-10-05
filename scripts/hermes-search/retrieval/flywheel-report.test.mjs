import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatRealReport, formatReport, nightOfFile, readNightRows, summarizeNight, summarizeReal } from './flywheel-report.mjs';

const live = (loss, extra = {}) => ({ outcome: loss == null ? 'answer' : 'no_result', shown: [], candidates: [], judged: 30, loss, vectorStatus: 'ok', ms: 10, ...extra });
const rows = [
  { a: 'a1', b: 'b1', seed: { style: 'terse' }, question: 'キズ 傷', kept: true, reason: null, overlap: 0.3, live: live(null) },
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
  assert.equal(summary.medianOverlap, 0.3);
  assert.deepEqual(summary.live, { scored: 5, shown: 1, otherShown: 1, notInPool: 1, judgeRejected: 1, status: 1, failed: 0, notRun: 1, denseFallbacks: 1, labelled: 0 });
});

test('labels count relevant shown records alongside rows already corrected by the runner', () => {
  const labelledRows = [
    { a: 'nonconformity:a1', question: '質問', kept: true, live: live('other_shown', { shown: ['nonconformity:r1', 'r2'] }) },
    { a: 'a2', question: '質問', kept: true, live: live(null, { shown: ['r3'], labelled: true }) },
    { a: 'a3', question: '質問', kept: true, live: live('other_shown', { shown: ['r4'] }) },
  ];
  const labels = { a1: { r1: { g: 3 }, r2: { g: 3 } }, a2: { r3: { g: 3 } }, a3: { r4: { g: 2 } } };
  const summary = summarizeNight(labelledRows, { labels });
  assert.equal(summary.live.shown, 2);
  assert.equal(summary.live.otherShown, 1);
  assert.equal(summary.live.shownAfterLabels, 1);
  assert.equal(summary.live.labelled, 2);
  assert.match(formatReport('2026-10-03', summary), /relevant shown 2, labelled relevant 2/u);
  const without = summarizeNight(labelledRows);
  assert.equal(without.live.labelled, 1);
  assert.equal(Object.hasOwn(without.live, 'shownAfterLabels'), false);
  assert.doesNotMatch(formatReport('2026-10-03', without), /labelled relevant/u);
  assert.equal(labelledRows[0].live.loss, 'other_shown');
});

test('report CLI applies one label file to multiple nights and retains positional files', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-report-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const files = ['2026-10-03', '2026-10-04'].map((day) => path.join(dir, `questions-${day}.jsonl`));
  const row = { a: 'a1', question: '質問', kept: true, live: live('other_shown', { shown: ['r1'] }) };
  for (const file of files) writeFileSync(file, `${JSON.stringify(row)}\n`);
  const labels = path.join(dir, 'labels.json');
  writeFileSync(labels, JSON.stringify({ schema: 'hermes-flywheel-labels/v1', labels: { a1: { r1: { g: 3 } } } }));
  const cli = new URL('./flywheel-report.mjs', import.meta.url);
  const labelled = spawnSync(process.execPath, [cli.pathname, files[0], '--labels', labels, files[1]], { encoding: 'utf8' });
  assert.equal(labelled.status, 0, labelled.stderr);
  assert.equal(labelled.stdout.match(/labelled relevant 1/gu).length, 2);
  const original = spawnSync(process.execPath, [cli.pathname, ...files], { encoding: 'utf8' });
  assert.equal(original.status, 0, original.stderr);
  assert.doesNotMatch(original.stdout, /labelled relevant/u);
});

test('the report prints the night in one block and names the file night', () => {
  const text = formatReport('2026-10-03', summarizeNight(rows));
  assert.match(text, /^night 2026-10-03: pairs 8, generated 7, kept 6 \(median 6 chars, anchor overlap 0\.30\)/u);
  assert.match(text, /dropped: copied_run 1, ungraded 1/u);
  assert.match(text, /live \(5 scored\): relevant shown 1, other records shown 1, nothing shown 3 \(outside judged candidates 1, rejected by judge 1, asked back or out of scope 1\), not run 1/u);
  assert.match(text, /dense fallbacks: 1/u);
  assert.equal(nightOfFile('/tmp/x/questions-2026-10-03.jsonl'), '2026-10-03');
  assert.equal(readNightRows('{"a":1}\nbroken\n\n{"a":2}\n').length, 2);
  const unscored = formatReport('2026-10-02', summarizeNight(rows.filter((row) => !row.live)));
  assert.match(unscored, /live: not run for 1 kept questions/u);
});

test('real summaries count only known relevance in shown and loss totals', () => {
  const realRows = [
    { source: 'real', relevant: ['a1'], dayOutcome: 'answer', live: live(null) },
    { source: 'real', relevant: ['b1'], dayOutcome: 'no_result', live: live('not_in_pool') },
    { source: 'real', relevant: ['c1'], dayOutcome: 'no_other', live: live('judge_rejected') },
    { source: 'real', relevant: ['d1'], dayOutcome: 'answer', live: live('other_shown') },
    { source: 'real', relevant: [], dayOutcome: 'no_result', live: live('not_in_pool') },
    { source: 'real', relevant: [], dayOutcome: 'answer', live: live(null) },
    ...rows,
  ];
  assert.deepEqual(summarizeReal(realRows), {
    questions: 6, withRelevant: 4, shown: 1, lossStages: { not_in_pool: 1, judge_rejected: 1, other_shown: 1 },
    dayOutcomes: { answer: 3, no_result: 2, no_other: 1 },
  });
  const formatted = formatRealReport('2026-10-03', summarizeReal(realRows));
  assert.match(formatted, /^real 2026-10-03: questions 6, with relevant 4, relevant shown 1, nothing shown 2 \(outside judged candidates 1, rejected by judge 1, asked back or out of scope 0\), other records shown 1, day outcomes answer 3, no_result 2, no_other 1$/u);
  assert.match(formatRealReport('2026-10-03', summarizeReal([])), /questions 0, with relevant 0, relevant shown 0.*day outcomes none/u);
});

test('real report CLI chooses the real summary alongside synthetic files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-report-real-'));
  const realFile = path.join(dir, 'real-2026-10-03.jsonl');
  const syntheticFile = path.join(dir, 'questions-2026-10-03.jsonl');
  writeFileSync(realFile, JSON.stringify({ source: 'real', relevant: ['a1'], dayOutcome: 'answer', live: live(null) }) + '\n');
  writeFileSync(syntheticFile, JSON.stringify(rows[0]) + '\n');
  const cli = spawnSync(process.execPath, [new URL('./flywheel-report.mjs', import.meta.url).pathname, syntheticFile, realFile], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /^night 2026-10-03:/u);
  assert.match(cli.stdout, /\nreal 2026-10-03: questions 1, with relevant 1, relevant shown 1/u);
  assert.equal(nightOfFile(realFile), '2026-10-03');
});
