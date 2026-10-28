import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { formatRealReport, formatReport, nightOfFile, readNightRows, summarizeLearned, summarizeNight, summarizeReal } from './flywheel-report.mjs';

const live = (loss, extra = {}) => ({ outcome: loss == null ? 'answer' : 'no_result', shown: [], candidates: [], judged: 30, loss, vectorStatus: 'ok', ms: 10, ...extra });

test('receipt report CLI prints route counts alongside unchanged synthetic and real reports', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-report-receipts-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const receiptFile = path.join(dir, 'receipts-2026-10-14.jsonl');
  const emptyFile = path.join(dir, 'receipts-2026-10-13.jsonl');
  const syntheticFile = path.join(dir, 'questions-2026-10-14.jsonl');
  const realFile = path.join(dir, 'real-2026-10-14.jsonl');
  writeFileSync(receiptFile, [
    { consultationRoute: { route: 'operation_guide', guideMiss: true, direct: true, question: '印刷の紙が出ない' } },
    { hermesReceipt: { outcome: 'answer' } },
  ].map(JSON.stringify).join('\n') + '\n{"torn');
  for (const file of [emptyFile, syntheticFile, realFile]) writeFileSync(file, '');
  const cli = spawnSync(process.execPath, [new URL('./flywheel-report.mjs', import.meta.url).pathname,
    syntheticFile, receiptFile, realFile, emptyFile], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(nightOfFile('receipts-2026-10-14.jsonl'), '2026-10-14');
  assert.equal(cli.stdout, [
    formatReport('2026-10-14', summarizeNight([])),
    'routes 2026-10-14: 操作説明 1 件(知識なし 1 件: 『印刷の紙が出ない』)',
    formatRealReport('2026-10-14', summarizeReal([])),
    'routes 2026-10-13: none', ''
  ].join('\n'));
});

const rows = [
  { a: 'a1', b: 'b1', seed: { style: 'terse' }, question: 'キズ 傷', kept: true, reason: null, overlap: 0.3, live: live(null) },
  { a: 'a2', b: 'b2', seed: { style: 'terse' }, question: 'テーブルの傷', kept: true, reason: null, live: live('not_in_pool', { vectorStatus: 'timeout' }) },
  { a: 'a3', b: 'b3', seed: { style: 'colloquial' }, question: 'テーブルに傷ついたことある？', kept: true, reason: null, live: live('judge_rejected') },
  { a: 'a4', b: 'b4', seed: { style: 'kana' }, question: 'きず', kept: true, reason: null, live: live('status', { outcome: 'clarification', unresolved: ['content'] }) },
  { a: 'a5', b: 'b5', seed: { style: 'terse' }, question: '塗装 はがれ', kept: true, reason: null, live: live('other_shown', { outcome: 'answer', plan: { ambiguousDropped: [{ field: 'partName', candidates: ['台A', '台B'] }] } }) },
  { a: 'a6', b: 'b6', seed: { style: 'terse' }, question: '昨夜の質問', kept: true, reason: null },
  { a: 'a7', b: 'b7', seed: { style: 'terse' }, question: 'そのまま写した文', kept: false, reason: 'copied_run' },
  { a: 'a8', b: 'b8', seed: { style: 'typo' }, question: null, kept: false, reason: 'ungraded' },
];

test('synthetic filter reporting leaves content statistics unchanged and lists only ids, templates and values', () => {
  const outcomes = ['ok', 'mismatch', 'unsupported', 'clarified', 'failed', 'unavailable'];
  const filters = outcomes.map((outcome, index) => ({
    id: `f-${index}`, source: 'synthetic', kind: 'filter', kept: true, a: 'hostile-anchor',
    question: 'QUESTION TEXT MUST NOT BE REPORTED', seed: { template: 'count3', value: 'North Shop' },
    live: { outcome: outcome === 'clarified' ? 'clarification' : ['failed', 'unavailable'].includes(outcome) ? outcome : 'answer', loss: 'other_shown' },
    filterCheck: { supported: outcome !== 'unsupported', ok: outcome === 'ok' },
  }));
  const { filter, ...content } = summarizeNight([...rows, ...filters]);
  const { filter: empty, ...baseline } = summarizeNight(rows);
  assert.deepEqual(content, baseline);
  assert.equal(empty.questions, 0);
  assert.deepEqual(filter, { questions: 6, supported: 5, ok: 1, mismatch: 1, unsupported: 1, clarified: 1, failed: 2,
    issues: [{ id: 'f-1', template: 'count3', value: 'North Shop' }, { id: 'f-2', template: 'count3', value: 'North Shop' }] });
  for (const input of [[...rows, ...filters], filters]) {
    const report = formatReport('2026-10-03', summarizeNight(input));
    assert.match(report, /synthetic filter: questions 6, supported 5, ok 1, mismatch 1, unsupported 1, clarified 1, failed 2/u);
    assert.match(report, /f-1: template="count3" value="North Shop"/u);
    assert.match(report, /f-2: template="count3" value="North Shop"/u);
    assert.doesNotMatch(report, /QUESTION TEXT|hostile-anchor/u);
  }
});

test('report counts unavailable and failed reasons while supporting older live lines', () => {
  const failures = [
    live('status', { outcome: 'unavailable', reason: 'relevance judgment failed: upstream_http 429' }),
    live('status', { outcome: 'unavailable', reason: 'relevance judgment failed: upstream_http 429' }),
    live('failed', { outcome: 'failed', reason: 'timeout' }),
    live('status', { outcome: 'unavailable' }),
    live(null, { outcome: 'answer', reason: 'ignored' }),
  ];
  const summary = summarizeNight(failures.map((live) => ({ question: 'キズ', kept: true, live })));
  assert.deepEqual(summary.unavailableReasons, { 'upstream_http 429': 2, timeout: 1, unknown: 1 });
  assert.match(formatReport('2026-10-03', summary), /unavailable reasons: upstream_http 429=2, timeout=1, unknown=1/u);
  assert.deepEqual(summarizeNight(rows).unavailableReasons, {});
  assert.doesNotMatch(formatReport('2026-10-03', summarizeNight(rows)), /unavailable reasons/u);
});

test('real reports count correct, mismatched and unsupported filter questions separately', () => {
  const rows = [
    { source: 'real', kind: 'filter', relevant: [], dayOutcome: 'answer', filterCheck: { supported: true, ok: true }, live: live(null) },
    { source: 'real', kind: 'filter', relevant: [], dayOutcome: 'answer', filterCheck: { supported: true, ok: false }, live: live('filter_mismatch') },
    { source: 'real', kind: 'filter', relevant: [], dayOutcome: 'answer', filterCheck: { supported: false, ok: null }, live: live('filter_unsupported') },
    { source: 'real', kind: 'filter', relevant: [], dayOutcome: 'answer' },
    { source: 'real', relevant: ['a'], dayOutcome: 'answer', live: live(null) },
    { source: 'synthetic', kind: 'filter', filterCheck: { supported: true, ok: true } },
  ];
  const summary = summarizeReal(rows);
  assert.deepEqual(summary.filter, { questions: 4, supported: 2, ok: 1, mismatch: 1 });
  assert.equal(summary.questions, 5);
  assert.equal(summary.withRelevant, 1);
  assert.equal(summary.shown, 1);
  assert.deepEqual(summary.lossStages, {});
  assert.match(formatRealReport('2026-10-03', summary), /filter questions 4, correct 1, mismatch 1, unsupported 2/u);
});

test('a night summary counts generation, keep decisions, and live loss stages', () => {
  const summary = summarizeNight(rows);
  assert.equal(summary.generated, 7);
  assert.equal(summary.kept, 6);
  assert.deepEqual(summary.dropped, { copied_run: 1, ungraded: 1 });
  assert.deepEqual(summary.styles, { terse: 4, colloquial: 1, kana: 1 });
  assert.equal(summary.medianLength, 6);
  assert.equal(summary.medianOverlap, 0.3);
  assert.deepEqual(summary.live, { scored: 5, shown: 1, otherShown: 1, notInPool: 1, judgeRejected: 1, status: 1, failed: 0, notRun: 1, denseFallbacks: 1, labelled: 0 });
  assert.deepEqual(summary.askedBackTerms, { content: 1 });
  assert.deepEqual(summary.ambiguousDroppedTerms, { partName: 1 });
  assert.match(formatReport('2026-10-03', summary), /asked back on: content 1/u);
  assert.match(formatReport('2026-10-03', summary), /ambiguous filter dropped for content search: partName 1/u);
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
    plannerVersions: {},
    questions: 6, withRelevant: 4, shown: 1, lossStages: { not_in_pool: 1, judge_rejected: 1, other_shown: 1 },
    dayOutcomes: { answer: 3, no_result: 2, no_other: 1 },
    filter: { questions: 0, supported: 0, ok: 0, mismatch: 0 },
    followUp: { questions: 0, withRelevant: 0, shown: 0, lossStages: {}, filterMismatch: 0, byAction: {}, countAnswers: 0 },
  });
  const formatted = formatRealReport('2026-10-03', summarizeReal(realRows));
  assert.match(formatted, /^real 2026-10-03: questions 6, with relevant 4, relevant shown 1, nothing shown 2 \(outside judged candidates 1, rejected by judge 1, asked back or out of scope 0\), other records shown 1, day outcomes answer 3, no_result 2, no_other 1\n  filter questions 0, correct 0, mismatch 0, unsupported 0$/u);
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

test('learned summary counts states and chooses the latest decision, independent of row order', () => {
  const check = { heldout: { n: 4, gained: 1, lost: 2 }, real: { n: 1, gained: 0, lost: 1 } };
  const rows = [{ state: 'candidate' }, { state: 'rejected', check, decidedAt: '2026-10-04T00:00:00Z' },
    { state: 'active', check: {}, decidedAt: '2026-10-03T00:00:00Z' }, { state: 'unknown' }, null];
  assert.deepEqual(summarizeLearned(rows), { candidates: 1, active: 1, rejected: 1, lastDecision: { state: 'rejected', check, decidedAt: '2026-10-04T00:00:00Z' } });
  assert.deepEqual(summarizeLearned([]), { candidates: 0, active: 0, rejected: 0, lastDecision: null });
});

test('report CLI accepts learned alongside nights and alone and prints check gains and losses', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-report-learned-'));
  const file = path.join(dir, 'learned-queries.jsonl');
  const nightFile = path.join(dir, 'questions-2026-10-03.jsonl');
  writeFileSync(nightFile, JSON.stringify(rows[0]) + '\n');
  const cli = new URL('./flywheel-report.mjs', import.meta.url).pathname;
  writeFileSync(file, [
    { state: 'candidate' }, { state: 'active', decidedAt: '2026-10-04T00:00:00Z', check: { heldout: { gained: 2, lost: 1 }, real: { gained: 1, lost: 0 } } },
    { state: 'rejected', decidedAt: '2026-10-03T00:00:00Z' },
  ].map(JSON.stringify).join('\n') + '\nbroken\n');
  const result = spawnSync(process.execPath, [cli, '--learned', file, nightFile], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^night 2026-10-03:/u);
  assert.match(result.stdout, /\nlearned: candidates 1, active 1, rejected 1, last decision active \(heldout 2\/1, real 1\/0\)\n$/u);
  writeFileSync(file, '');
  const empty = spawnSync(process.execPath, [cli, '--learned', file], { encoding: 'utf8' });
  assert.equal(empty.status, 0, empty.stderr);
  assert.equal(empty.stdout, 'learned: candidates 0, active 0, rejected 0, last decision none (heldout 0/0, real 0/0)\n');
});

test('real follow-up turns are counted apart with their own losses', () => {
  const previousPlan = { sources: ['nonconformity'], filters: [], semanticQuery: '傷', sort: null, limit: 5 };
  const realRows = [
    { source: 'real', relevant: ['a1'], dayOutcome: 'answer', live: live(null) },
    { source: 'real', relevant: ['b1'], dayOutcome: 'answer', previousPlan, live: live('other_shown') },
    { source: 'real', relevant: ['c1'], dayOutcome: 'no_result', previousPlan, live: live('not_in_pool') },
    { source: 'real', relevant: ['d1'], dayOutcome: 'answer', previousPlan, live: live(null) },
    { source: 'real', kind: 'filter', relevant: [], dayOutcome: 'answer', previousPlan, filterCheck: { supported: true, ok: false }, live: live('filter_mismatch') },
    { source: 'real', kind: 'filter', relevant: [], dayOutcome: 'answer', filterCheck: { supported: true, ok: false }, live: live('filter_mismatch') },
  ];
  const summary = summarizeReal(realRows);
  assert.deepEqual(summary.followUp, { questions: 4, withRelevant: 3, shown: 1, lossStages: { other_shown: 1, not_in_pool: 1 }, filterMismatch: 1, countAnswers: 0, byAction: { unclassified: { questions: 4, withRelevant: 3, shown: 1, lossStages: { other_shown: 1, not_in_pool: 1 } } } });
  assert.equal(summary.questions, 6);
  assert.equal(summary.filter.mismatch, 2);
  const formatted = formatRealReport('2026-10-03', summary);
  assert.match(formatted, /\n  follow-up turns 4, with relevant 3, relevant shown 1, lost other_shown 1, not_in_pool 1, filter mismatch 1, count answers 0\n    unclassified: turns 4, with relevant 3, relevant shown 1, lost other_shown 1, not_in_pool 1$/u);
  assert.equal(formatRealReport('2026-10-03', summarizeReal(realRows.slice(0, 1))).includes('follow-up'), false);
});


test('follow-up report groups actions and counts count answers without recording a record loss', () => {
  const rows = ['count', 'more', 'add', null].map(action => ({ source: 'real', previousPlan: {}, relevant: ['a'], dayOutcome: 'answer',
    live: live(action === 'count' ? 'count_answer' : null, { followUpAction: action, outcome: action === 'count' ? 'count' : 'answer' }) }));
  const summary = summarizeReal(rows);
  assert.equal(summary.followUp.countAnswers, 1);
  assert.equal(summary.followUp.byAction.count.withRelevant, 1);
  assert.equal(summary.followUp.byAction.count.shown, 0);
  const report = formatRealReport('2026-10-26', summary);
  assert.match(report, /count answers 1/u);
  assert.match(report, /    count: turns 1, with relevant 1, relevant shown 0, lost count_answer 1/u);
  for (const action of ['more', 'add', 'unclassified']) assert.ok(report.includes(`    ${action}: turns 1, with relevant 1, relevant shown 1, lost none`));
  assert.match(report, /nothing shown 0/u);
});


test('night and real reports show recorded planner version counts', () => {
  const questionVersion = 'planner-questions-2026-10-26b';
  const versionRows = [{ ...rows[0], live: { ...live(null), questionVersion } }, { ...rows[0], live: { ...live(null), questionVersion } }];
  assert.match(formatReport('2026-10-28', summarizeNight(versionRows)), /planner versions: planner-questions-2026-10-26b 2/u);
  assert.match(formatRealReport('2026-10-28', summarizeReal(versionRows.map((row) => ({ ...row, source: 'real' })))), /planner versions: planner-questions-2026-10-26b 2/u);
});
