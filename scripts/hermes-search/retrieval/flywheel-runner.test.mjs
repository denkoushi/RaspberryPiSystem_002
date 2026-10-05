import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_MAX_QUESTIONS, MAX_QUESTIONS_CAP, REAL_LABEL_DEPTH, flywheelSettings, nightOf, questionsPath, runFlywheelNight, usedAnchors } from './flywheel-runner.mjs';
import { readRealRows, realId, realPath } from './flywheel-real.mjs';
import { splitOf } from './flywheel-gate.mjs';

function unit(values) {
  const norm = Math.hypot(...values);
  return Float32Array.from(values.map((value) => value / norm));
}

const records = [
  { id: 'nonconformity:a1', originDepartmentName: 'North Shop', partName: 'Table', condition: 'clamp was loose', remarks: 'surface scratch on the table top', disposition: 'repolished' },
  { id: 'nonconformity:b1', originDepartmentName: 'North Shop', partName: 'Column', condition: 'tool hit the part', remarks: 'dent on the column face', disposition: 'remade' },
  { id: 'nonconformity:c1', originDepartmentName: 'North Shop', partName: 'Base', condition: 'paint was thin', remarks: 'paint peeled off the base', disposition: 'repainted' },
];
const dense = [
  { id: 'nonconformity:a1', vector: unit([1, 0.2, 0]) },
  { id: 'nonconformity:b1', vector: unit([1, 0.6, 0]) },
  { id: 'nonconformity:c1', vector: unit([0.9, 0.1, 0.3]) },
];
// 23:30 Tokyo on 2026-10-03.
const night = () => new Date('2026-10-03T14:30:00Z');

function settings(dir, extra = {}) {
  return { enabled: true, maxQuestions: 10, window: '22-6', dir, denseStore: 'unused', origin: 'http://dgx', token: 't', egress: '', model: 'm', ...extra };
}

function fakeChat({ slowAfter = Infinity } = {}) {
  let calls = 0;
  return async ({ messages, schema }) => {
    calls += 1;
    if (calls > slowAfter) return { ok: false, reason: 'timeout' };
    if (schema.required[0] === 'question') return { ok: true, content: JSON.stringify({ question: `キズ ${calls}` }) };
    const grade = messages[1].content.includes('scratch') || messages[1].content.includes('dent') || messages[1].content.includes('peeled') ? 3 : 1;
    return { ok: true, content: JSON.stringify({ grade }) };
  };
}

const jevEvaluate = async (input) => ({
  answers: Object.fromEntries(Object.keys(input.questions).map((key) => [key, { type: 'choice', choice: 'g3' }])),
});

// Live scorer that always shows the anchor; tests of the stages inject their own.
const liveShown = async (row) => ({ outcome: 'answer', shown: [row.a], candidates: [row.a, row.b], judged: 30, loss: null, vectorStatus: 'ok', ms: 1 });

test('settings default to off, cap the nightly budget, and follow the enrichment window', () => {
  const off = flywheelSettings({});
  assert.equal(off.enabled, false);
  assert.equal(off.maxQuestions, DEFAULT_MAX_QUESTIONS);
  assert.equal(off.labelBudget, 60);
  assert.equal(off.realBudget, 20);
  assert.equal(REAL_LABEL_DEPTH, 5);
  assert.equal(flywheelSettings({ HERMES_FLYWHEEL_REAL_BUDGET: '9999' }).realBudget, 100);
  assert.equal(flywheelSettings({ HERMES_FLYWHEEL_REAL_BUDGET: '0' }).realBudget, 0);
  for (const value of ['x', '', ' ', '-1', '1.5', '20junk']) {
    assert.equal(flywheelSettings({ HERMES_FLYWHEEL_REAL_BUDGET: value }).realBudget, 20);
  }
  assert.equal(flywheelSettings({ HERMES_FLYWHEEL_LABEL_BUDGET: '9999' }).labelBudget, 300);
  assert.equal(flywheelSettings({ HERMES_FLYWHEEL_LABEL_BUDGET: '0' }).labelBudget, 0);
  for (const value of ['x', '', '-1', '1.5', '60junk']) {
    assert.equal(flywheelSettings({ HERMES_FLYWHEEL_LABEL_BUDGET: value }).labelBudget, 60);
  }
  const on = flywheelSettings({ HERMES_FLYWHEEL_ENABLED: 'true', HERMES_FLYWHEEL_MAX_QUESTIONS: '9999', HERMES_RETRIEVAL_ENRICHMENT_WINDOW: '22-6' });
  assert.equal(on.enabled, true);
  assert.equal(on.maxQuestions, MAX_QUESTIONS_CAP);
  assert.equal(on.window, '22-6');
  assert.equal(flywheelSettings({ HERMES_FLYWHEEL_MAX_QUESTIONS: 'x' }).maxQuestions, DEFAULT_MAX_QUESTIONS);
  // A night that runs past midnight keeps the date it started on.
  assert.equal(nightOf(new Date('2026-10-03T14:30:00Z')), '2026-10-03');
  assert.equal(nightOf(new Date('2026-10-03T19:30:00Z')), '2026-10-03');
});

test('the runner stays idle when disabled, outside the window, or without an inference route', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const lines = [];
  const log = (line) => lines.push(line);
  assert.equal((await runFlywheelNight({ records, settings: settings(dir, { enabled: false }), now: night, log })).reason, 'disabled');
  assert.equal((await runFlywheelNight({ records, settings: settings(dir), now: () => new Date('2026-10-03T03:00:00Z'), log })).reason, 'outside_window');
  assert.equal((await runFlywheelNight({ records, settings: settings(dir, { origin: '', token: '' }), now: night, log })).reason, 'not_configured');
  assert.match(lines[0], /^hermes retrieval flywheel reason=disabled /u);
  const status = JSON.parse(readFileSync(path.join(dir, 'flywheel-status.json'), 'utf8'));
  assert.equal(status.reason, 'not_configured');
});

test('a night writes one text-free line per pair, keeps confirmed anchors, and respects the budget', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const status = await runFlywheelNight({
    records, settings: settings(dir, { maxQuestions: 2 }), now: night, readDense: async () => dense, chat: fakeChat(), jevEvaluate, live: liveShown, seed: 7, log: () => {},
  });
  assert.equal(status.reason, 'completed');
  assert.equal(status.night, '2026-10-03');
  const rows = readFileSync(questionsPath(dir, '2026-10-03'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.ok(row.question.startsWith('キズ'));
    assert.deepEqual(Object.keys(row.grades), ['dgx', 'jev']);
    assert.equal(row.kept, true);
    assert.equal(row.retried, false);
    assert.equal(JSON.stringify(row).includes('surface scratch'), false);
    assert.equal(row.live.loss, null);
    assert.deepEqual(row.live.shown, [row.a]);
  }
  assert.equal(status.kept, 2);
  assert.equal(status.shown, 2);
  assert.equal(status.pendingLive, 0);
  // The budget is spent for this night; a second start retains the nightly live totals.
  const again = await runFlywheelNight({ records, settings: settings(dir, { maxQuestions: 2 }), now: night, readDense: async () => dense, chat: fakeChat(), jevEvaluate, live: liveShown, log: () => {} });
  assert.equal(again.reason, 'budget_reached');
  assert.equal(again.generated, 0);
  assert.equal(again.shown, 2);
  assert.equal(again.pendingLive, 0);
  // Anchors used on earlier nights are not used again.
  const used = await usedAnchors(dir);
  assert.equal(used.size, 2);
});

test('the runner stops for the night when the business LLM stays slow or failing', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const status = await runFlywheelNight({
    records, settings: settings(dir), now: night, readDense: async () => dense, chat: fakeChat({ slowAfter: 1 }), jevEvaluate, live: liveShown, seed: 7, log: () => {},
  });
  assert.equal(status.reason, 'dgx_busy');
  assert.ok(status.dropped >= 1);
  const rows = readFileSync(questionsPath(dir, '2026-10-03'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(rows.length < 3);
});

test('a missing dense store ends the night without calling the model', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  let called = false;
  const status = await runFlywheelNight({
    records, settings: settings(dir), now: night, readDense: async () => { throw new Error('missing'); },
    chat: async () => { called = true; return { ok: false }; }, jevEvaluate, log: () => {},
  });
  assert.equal(status.reason, 'dense_unavailable');
  assert.equal(called, false);
  writeFileSync(path.join(dir, 'questions-2026-10-02.jsonl'), '{"a":"x1"}\nnot json\n');
  assert.deepEqual(await usedAnchors(dir), new Set(['x1']));
});

test('kept questions are scored against the live pipeline and the loss stage is counted', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  let calls = 0;
  const live = async (row) => {
    calls += 1;
    const generated = readFileSync(questionsPath(dir, '2026-10-03'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(generated.length, 2);
    assert.ok(generated.every((line) => !Object.hasOwn(line, 'live')));
    return calls === 1
      ? { outcome: 'no_result', shown: [], candidates: ['zz', row.a], judged: 30, loss: 'judge_rejected', vectorStatus: 'timeout', ms: 5 }
      : { outcome: 'clarification', shown: [], candidates: [], judged: 30, loss: 'status', vectorStatus: null, ms: 2 };
  };
  const status = await runFlywheelNight({
    records, settings: settings(dir, { maxQuestions: 2 }), now: night, readDense: async () => dense, chat: fakeChat(), jevEvaluate, live, seed: 7, log: () => {},
  });
  assert.equal(status.kept, 2);
  assert.equal(status.shown, 0);
  assert.deepEqual(status.lossStages, { judge_rejected: 1, status: 1 });
  const rows = readFileSync(questionsPath(dir, '2026-10-03'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(rows[0].live.loss, 'judge_rejected');
  assert.deepEqual(rows[0].live.candidates, ['zz', rows[0].a]);
  assert.equal(rows[1].live.outcome, 'clarification');
  // Dropped questions are not scored.
  assert.equal(calls, 2);
});

test('a spent budget backfills kept questions in file order and retains nightly live totals', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const filePath = questionsPath(dir, '2026-10-03');
  const initial = [
    { a: 'a1', b: 'b1', question: 'キズの記録', kept: true },
    { a: 'b1', b: 'c1', question: 'へこみの記録', kept: true },
    { a: 'c1', question: '塗装の記録', kept: false, reason: 'not_relevant' },
  ];
  writeFileSync(filePath, `${initial.map((row) => JSON.stringify(row)).join('\n')}\n`);
  const scored = [];
  const logs = [];
  const live = async (row) => {
    scored.push(row.a);
    const result = await liveShown(row);
    return row.a === 'a1' ? result : { ...result, shown: [], loss: 'judge_rejected' };
  };
  const input = {
    records, settings: settings(dir, { maxQuestions: initial.length }), now: night,
    readDense: async () => dense, chat: async () => { assert.fail('a spent budget must not call DGX chat'); },
    jevEvaluate, live, log: (line) => logs.push(line),
  };
  const status = await runFlywheelNight(input);
  assert.equal(status.reason, 'budget_reached');
  assert.equal(status.generated, 0);
  assert.equal(status.kept, 0);
  assert.equal(status.dropped, 0);
  assert.deepEqual(status.dropReasons, {});
  assert.deepEqual(scored, ['a1', 'b1']);
  assert.equal(status.shown, 1);
  assert.deepEqual(status.lossStages, { judge_rejected: 1 });
  assert.equal(status.pendingLive, 0);
  assert.match(logs[0], / pending=0 labelled=0 labelPending=0 real=0$/u);
  const raw = readFileSync(filePath, 'utf8');
  assert.ok(raw.endsWith('\n'));
  const rows = raw.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(rows.length, initial.length);
  assert.deepEqual(rows[0], { ...initial[0], live: await liveShown(initial[0]) });
  assert.equal(rows[1].live.loss, 'judge_rejected');
  assert.deepEqual(rows[2], initial[2]);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'flywheel-status.json'), 'utf8')), status);

  const again = await runFlywheelNight(input);
  assert.deepEqual(scored, ['a1', 'b1']);
  assert.equal(again.shown, 1);
  assert.deepEqual(again.lossStages, { judge_rejected: 1 });
  assert.equal(again.pendingLive, 0);
  assert.equal(readFileSync(filePath, 'utf8'), raw);
});

test('a spent generation budget still labels other shown records and rewrites live totals', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const file = questionsPath(dir, '2026-10-03');
  const initial = { a: 'nonconformity:a1', b: 'c1', question: 'へこみの記録', kept: true };
  writeFileSync(file, `${JSON.stringify(initial)}\n`);
  let dgxCalls = 0;
  let jevCalls = 0;
  const input = {
    records, settings: settings(dir, { maxQuestions: 1 }), now: night, readDense: async () => dense,
    chat: async (request) => {
      dgxCalls += 1;
      assert.equal(request.schema.required[0], 'grade');
      assert.match(request.messages[1].content, /へこみの記録/u);
      assert.match(request.messages[1].content, /dent on the column face/u);
      return { ok: true, content: '{"grade":3}' };
    },
    jevEvaluate: async (input) => { jevCalls += 1; return jevEvaluate(input); },
    live: async (row) => ({ ...await liveShown(row), shown: ['nonconformity:b1'], loss: 'other_shown' }),
    log: () => {},
  };
  const status = await runFlywheelNight(input);
  const labelsFile = path.join(dir, 'labels.json');
  assert.deepEqual(JSON.parse(readFileSync(labelsFile, 'utf8')), {
    schema: 'hermes-flywheel-labels/v1',
    labels: { a1: { b1: { g: 3, dgx: 3, jev: 3, night: '2026-10-03' } } },
  });
  assert.equal(statSync(labelsFile).mode & 0o777, 0o600);
  assert.equal(readFileSync(labelsFile, 'utf8').includes('dent'), false);
  const row = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(row, { ...initial, live: { ...await input.live(initial), loss: null, labelled: true } });
  assert.equal(status.reason, 'budget_reached');
  assert.equal(status.shown, 1);
  assert.deepEqual(status.lossStages, {});
  assert.equal(status.labelled, 1);
  assert.equal(status.labelPending, 0);
  const again = await runFlywheelNight(input);
  assert.equal(again.shown, 1);
  assert.equal(again.labelled, 0);
  assert.equal(again.labelPending, 0);
  assert.equal(dgxCalls, 1);
  assert.equal(jevCalls, 1);
});

test('zero label budget leaves shown pairs pending without calling either grader', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const file = questionsPath(dir, '2026-10-03');
  writeFileSync(file, `${JSON.stringify({ a: 'a1', question: 'へこみ', kept: true })}\n`);
  const status = await runFlywheelNight({
    records, settings: settings(dir, { maxQuestions: 1, labelBudget: 0 }), now: night, readDense: async () => dense,
    chat: async () => assert.fail('zero budget must not call DGX'),
    jevEvaluate: async () => assert.fail('zero budget must not call JEV'),
    live: async (row) => ({ ...await liveShown(row), loss: 'other_shown', shown: ['nonconformity:b1'] }), log: () => {},
  });
  assert.equal(status.labelled, 0);
  assert.equal(status.labelPending, 1);
  assert.equal(status.shown, 0);
  assert.deepEqual(status.lossStages, { other_shown: 1 });
});

test('label budgets are cumulative per night, batch by question, and resume with existing labels', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const file = questionsPath(dir, '2026-10-03');
  const row = { a: 'a1', b: 'c1', grades: { dgx: { b: 3 }, jev: { b: 3 } }, question: '質問', kept: true,
    live: { loss: 'other_shown', shown: ['nonconformity:b1', 'b1', 'd1', 'e1'] } };
  writeFileSync(file, `${JSON.stringify(row)}\n`);
  writeFileSync(path.join(dir, 'labels.json'), JSON.stringify({ schema: 'hermes-flywheel-labels/v1', labels: {
    previous: { r: { g: 0, dgx: 0, jev: 0, night: '2026-10-03' }, s: { g: 0, night: '2026-10-02' } },
  } }));
  const batches = [];
  const input = {
    records: [...records, ...['d1', 'e1'].map((id) => ({ id, condition: id }))],
    settings: settings(dir, { maxQuestions: 1, labelBudget: 3 }), now: night, readDense: async () => dense,
    chat: async () => ({ ok: true, content: '{"grade":2}' }),
    jevEvaluate: async (input) => { batches.push(Object.keys(input.questions).length); return jevEvaluate(input); }, log: () => {},
  };
  const status = await runFlywheelNight(input);
  assert.equal(status.labelled, 2);
  assert.equal(status.labelPending, 1);
  assert.deepEqual(batches, [2]);
  const stored = JSON.parse(readFileSync(path.join(dir, 'labels.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored.labels.a1), ['b1', 'd1']);
  assert.equal(stored.labels.a1.b1.g, 2);
  const again = await runFlywheelNight(input);
  assert.equal(again.labelled, 0);
  assert.equal(again.labelPending, 1);
  const resumed = await runFlywheelNight({ ...input, settings: settings(dir, { maxQuestions: 1, labelBudget: 4 }) });
  assert.equal(resumed.labelled, 1);
  assert.equal(resumed.labelPending, 0);
  assert.deepEqual(batches, [2, 1]);
});

test('the DGX busy guard saves attempted labels and leaves the rest pending', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const file = questionsPath(dir, '2026-10-03');
  const ids = ['b1', 'c1', 'd1', 'e1', 'f1'];
  writeFileSync(file, `${JSON.stringify({ a: 'a1', question: '質問', kept: true, live: { loss: 'other_shown', shown: ids } })}\n`);
  const status = await runFlywheelNight({
    records: [...records, ...ids.slice(2).map((id) => ({ id, condition: id }))],
    settings: settings(dir, { maxQuestions: 1 }), now: night, readDense: async () => dense,
    chat: fakeChat({ slowAfter: 0 }), jevEvaluate, log: () => {},
  });
  assert.equal(status.reason, 'dgx_busy');
  assert.equal(status.labelled, 3);
  assert.equal(status.labelPending, 2);
  assert.equal(status.shown, 0);
  const labels = JSON.parse(readFileSync(path.join(dir, 'labels.json'), 'utf8')).labels.a1;
  assert.deepEqual(Object.keys(labels), ids.slice(0, 3));
  assert.deepEqual(labels.b1, { g: null, dgx: null, jev: 3, night: '2026-10-03' });
});

test('labelling checks the window before each pair and persists null JEV grades', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const file = questionsPath(dir, '2026-10-03');
  writeFileSync(file, `${JSON.stringify({ a: 'a1', question: '質問', kept: true, live: { loss: 'other_shown', shown: ['b1', 'c1'] } })}\n`);
  let calls = 0;
  const status = await runFlywheelNight({
    records, settings: settings(dir, { maxQuestions: 1 }),
    now: () => calls === 0 ? night() : new Date('2026-10-03T21:00:00Z'), readDense: async () => dense,
    chat: async () => { calls += 1; return { ok: true, content: '{"grade":3}' }; },
    jevEvaluate: async () => { throw new Error('unavailable'); }, log: () => {},
  });
  assert.equal(calls, 1);
  assert.equal(status.labelled, 1);
  assert.equal(status.labelPending, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'labels.json'), 'utf8')).labels.a1.b1,
    { g: null, dgx: 3, jev: null, night: '2026-10-03' });
});

test('live backfill stops outside the window, preserves the generation reason, and resumes next time', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const filePath = questionsPath(dir, '2026-10-03');
  const initial = [
    { a: 'a1', question: 'キズの記録', kept: true },
    { a: 'b1', question: 'へこみの記録', kept: true },
  ];
  writeFileSync(filePath, `${initial.map((row) => JSON.stringify(row)).join('\n')}\n`);
  let calls = 0;
  const input = {
    records, settings: settings(dir, { maxQuestions: initial.length }), readDense: async () => dense,
    jevEvaluate, log: () => {},
  };
  const status = await runFlywheelNight({
    ...input,
    now: () => calls === 0 ? night() : new Date('2026-10-03T21:00:00Z'),
    live: async (row) => { calls += 1; return liveShown(row); },
  });
  assert.equal(calls, 1);
  assert.equal(status.reason, 'budget_reached');
  assert.equal(status.pendingLive, 1);
  assert.equal(status.shown, 1);
  const rows = readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(rows[0].live.shown, ['a1']);
  assert.deepEqual(rows[1], initial[1]);

  const again = await runFlywheelNight({ ...input, now: night, live: liveShown });
  assert.equal(again.reason, 'budget_reached');
  assert.equal(again.pendingLive, 0);
  assert.equal(again.shown, 2);
});

test('no pairs still backfills valid rows and drops malformed lines when rewriting', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const filePath = questionsPath(dir, '2026-10-03');
  const initial = { a: 'a1', question: 'キズの記録', kept: true };
  writeFileSync(filePath, `${JSON.stringify(initial)}\nnot json\n`);
  const status = await runFlywheelNight({
    records, settings: settings(dir), now: night, readDense: async () => [],
    chat: async () => { assert.fail('no pairs must not call DGX chat'); },
    jevEvaluate, live: liveShown, log: () => {},
  });
  assert.equal(status.reason, 'no_pairs');
  assert.equal(status.generated, 0);
  assert.equal(status.shown, 1);
  assert.equal(status.pendingLive, 0);
  assert.equal(readFileSync(filePath, 'utf8'), `${JSON.stringify({ ...initial, live: await liveShown(initial) })}\n`);
});

test('the busy guard stops generation but still backfills kept rows with failed generations marked unretried', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const filePath = questionsPath(dir, '2026-10-03');
  writeFileSync(filePath, `${JSON.stringify({ a: 'a1', question: 'キズの記録', kept: true })}\n`);
  const status = await runFlywheelNight({
    records, settings: settings(dir), now: night, readDense: async () => dense,
    chat: fakeChat({ slowAfter: 1 }), jevEvaluate, live: liveShown, seed: 7, log: () => {},
  });
  assert.equal(status.reason, 'dgx_busy');
  assert.equal(status.generated, 1);
  assert.ok(status.dropped >= 1);
  assert.equal(status.shown, 1);
  assert.equal(status.pendingLive, 0);
  const rows = readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(rows[0].live.shown, ['a1']);
  assert.ok(rows.slice(1).some((row) => row.question === null));
  for (const row of rows.slice(1)) {
    assert.equal(row.retried, false);
    assert.equal(Object.hasOwn(row, 'live'), false);
  }
});

function realFixture(extra = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'flywheel-real-runner-'));
  const dir = path.join(root, 'flywheel');
  const receiptsDir = path.join(root, 'receipts');
  mkdirSync(dir);
  mkdirSync(receiptsDir);
  const receipt = (question, semanticQuery = question, recordIds = ['nonconformity:a1']) => ({
    at: '2026-10-03T03:00:00Z', recordIds,
    hermesReceipt: { question, outcome: 'answer', plan: { semanticQuery } },
  });
  writeFileSync(path.join(receiptsDir, 'receipts-2026-10-03.jsonl'), [receipt('傷はある？'), receipt('North Shopだけ', '')].map(JSON.stringify).join('\n') + '\n');
  return { dir, receiptsDir, receipt, input: {
    records, settings: settings(dir, { maxQuestions: 0, labelBudget: 0, ...extra }), now: night,
    readDense: async () => dense, chat: async () => ({ ok: true, content: '{"grade":3}' }), jevEvaluate,
    live: async (row) => {
      assert.deepEqual(row, { a: null, b: null, question: '傷はある？', grades: null });
      return { outcome: 'answer', shown: ['nonconformity:a1'], candidates: ['a1', 'b1'], judged: 30, loss: 'other_shown', vectorStatus: 'ok', ms: 1 };
    }, log: () => {},
  } };
}

test('real content questions get consensus labels and corrected loss once across starts and nights', async () => {
  const { dir, input } = realFixture();
  const logs = [];
  const status = await runFlywheelNight({ ...input, log: (line) => logs.push(line) });
  const file = realPath(dir, '2026-10-03');
  const rows = readRealRows(readFileSync(file, 'utf8'));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.source, 'real');
  assert.equal(row.id, realId('傷はある？'));
  assert.equal(row.split, splitOf(row.id));
  assert.equal(row.receiptAt, '2026-10-03T03:00:00Z');
  assert.equal(row.dayOutcome, 'answer');
  assert.deepEqual(row.dayShown, ['a1']);
  assert.deepEqual(row.relevant, ['a1', 'b1']);
  assert.equal(row.live.loss, null);
  assert.deepEqual(row.labels, { a1: { g: 3, dgx: 3, jev: 3 }, b1: { g: 3, dgx: 3, jev: 3 } });
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'labels.json'), 'utf8')).labels[row.id], {
    a1: { g: 3, dgx: 3, jev: 3, night: '2026-10-03' }, b1: { g: 3, dgx: 3, jev: 3, night: '2026-10-03' },
  });
  assert.equal(status.real, 1);
  assert.equal(status.realPending, 0);
  assert.equal(status.labelled, 0);
  assert.match(logs[0], / real=1$/u);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readFileSync(file, 'utf8').includes('surface scratch'), false);
  const again = await runFlywheelNight({ ...input, live: async () => assert.fail('already processed') });
  assert.equal(again.real, 0);
  assert.equal(again.realPending, 0);
  assert.equal(readRealRows(readFileSync(file, 'utf8')).length, 1);
  const next = await runFlywheelNight({ ...input, now: () => new Date('2026-10-04T14:30:00Z'), live: async () => assert.fail('previously processed night') });
  assert.equal(next.real, 0);
});

test('zero real budget leaves receipt questions pending without scoring or grading', async () => {
  const { dir, input } = realFixture({ realBudget: 0 });
  const status = await runFlywheelNight({ ...input,
    live: async () => assert.fail('zero real budget'), chat: async () => assert.fail('zero real budget'), jevEvaluate: async () => assert.fail('zero real budget'),
  });
  assert.equal(status.real, 0);
  assert.equal(status.realPending, 1);
  assert.equal(existsSync(realPath(dir, '2026-10-03')), false);
});

test('the real budget subtracts existing night rows and includes previous-day receipts', async () => {
  const { dir, input, receiptsDir, receipt } = realFixture({ realBudget: 2 });
  writeFileSync(realPath(dir, '2026-10-03'), '{"source":"real","id":"previous"}\n');
  writeFileSync(path.join(receiptsDir, 'receipts-2026-10-02.jsonl'), JSON.stringify(receipt('へこみはある？')) + '\n');
  const status = await runFlywheelNight(input);
  assert.equal(status.real, 1);
  assert.equal(status.realPending, 1);
  const again = await runFlywheelNight(input);
  assert.equal(again.real, 0);
  assert.equal(again.realPending, 1);
  assert.equal(readRealRows(readFileSync(realPath(dir, '2026-10-03'), 'utf8')).length, 2);
});

test('real labels cover top candidates, shown and day-shown ids once and retain unknown relevance', async () => {
  const { dir, input, receiptsDir, receipt } = realFixture();
  writeFileSync(path.join(receiptsDir, 'receipts-2026-10-03.jsonl'), JSON.stringify(receipt('傷はある？', '傷', ['nonconformity:d1'])) + '\n');
  const ids = ['a1', 'b1', 'c1', 'e1', 'f1', 'g1'];
  await runFlywheelNight({ ...input, records: [...records, ...['d1', 'e1', 'f1', 'g1', 'h1'].map((id) => ({ id, condition: id }))],
    live: async () => ({ outcome: 'no_result', shown: ['nonconformity:h1', 'h1', 'missing'], candidates: ids, judged: 30, loss: null }),
    chat: async () => ({ ok: true, content: '{"grade":2}' }),
  });
  const row = readRealRows(readFileSync(realPath(dir, '2026-10-03'), 'utf8'))[0];
  assert.deepEqual(Object.keys(row.labels), ['a1', 'b1', 'c1', 'e1', 'f1', 'h1', 'd1']);
  assert.deepEqual(row.relevant, []);
  assert.equal(row.live.loss, 'not_in_pool');
});

test('real grading stops on DGX busy and resumes partially saved labels', async () => {
  const { dir, input } = realFixture();
  const ids = ['a1', 'b1', 'c1', 'd1', 'e1'];
  const run = { ...input, records: [...records, ...ids.slice(3).map((id) => ({ id, condition: id }))],
    live: async () => ({ outcome: 'no_result', shown: [], candidates: ids, judged: 30, loss: null }),
  };
  const status = await runFlywheelNight({ ...run, chat: fakeChat({ slowAfter: 0 }) });
  assert.equal(status.reason, 'dgx_busy');
  assert.equal(status.real, 0);
  assert.equal(status.realPending, 1);
  assert.equal(existsSync(realPath(dir, '2026-10-03')), false);
  assert.equal(Object.keys(JSON.parse(readFileSync(path.join(dir, 'labels.json'), 'utf8')).labels[realId('傷はある？')]).length, 3);
  let graded = 0;
  const resumed = await runFlywheelNight({ ...run, chat: async () => { graded += 1; return { ok: true, content: '{"grade":3}' }; } });
  assert.equal(resumed.real, 1);
  assert.equal(resumed.realPending, 0);
  assert.equal(graded, 2);
});

test('real grading checks the window and preserves pending questions for the next start', async () => {
  const { dir, input } = realFixture();
  let calls = 0;
  const status = await runFlywheelNight({ ...input,
    now: () => calls === 0 ? night() : new Date('2026-10-03T21:00:00Z'),
    chat: async () => { calls += 1; return { ok: true, content: '{"grade":3}' }; },
  });
  assert.equal(status.real, 0);
  assert.equal(status.realPending, 1);
  assert.equal(existsSync(realPath(dir, '2026-10-03')), false);
  const resumed = await runFlywheelNight(input);
  assert.equal(resumed.real, 1);
});

test('saved real labels do not consume the synthetic label budget', async () => {
  const { dir, input } = realFixture();
  await runFlywheelNight(input);
  writeFileSync(questionsPath(dir, '2026-10-03'), JSON.stringify({ a: 'a1', question: '合成', kept: true, live: { loss: 'other_shown', shown: ['b1'] } }) + '\n');
  const status = await runFlywheelNight({ ...input, settings: settings(dir, { maxQuestions: 1, labelBudget: 1 }) });
  assert.equal(status.labelled, 1);
  assert.equal(status.labelPending, 0);
  assert.equal(status.real, 0);
});
