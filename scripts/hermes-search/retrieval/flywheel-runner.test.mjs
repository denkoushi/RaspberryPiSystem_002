import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_MAX_QUESTIONS, MAX_QUESTIONS_CAP, REAL_LABEL_DEPTH, acquireRunnerLock, flywheelSettings, nightOf, questionsPath, runFlywheelNight, usedAnchors } from './flywheel-runner.mjs';
import { readRealRows, realId, realPath } from './flywheel-real.mjs';
import { splitOf } from './flywheel-gate.mjs';
import { learnedPath, readLearned, writeLearned, LEARNED_SCHEMA } from './flywheel-learn.mjs';

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
  return { enabled: true, maxQuestions: 10, learnBudget: 0, window: '22-6', dir, denseStore: 'unused', origin: 'http://dgx', token: 't', egress: '', model: 'm', ...extra };
}

function fakeChat({ slowAfter = Infinity } = {}) {
  let calls = 0;
  return async ({ messages, schema }) => {
    if (!schema) return { ok: true, content: 'OK' };
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
const liveShown = async (row) => ({ outcome: 'answer', reason: null, shown: [row.a], candidates: [row.a, row.b], judged: 30, loss: null, vectorStatus: 'ok', ms: 1 });

test('runner persists live reasons and its own private log across midnight and starts', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const file = questionsPath(dir, '2026-10-03');
  writeFileSync(file, JSON.stringify({ a: 'a1', question: 'キズの記録', kept: true }) + '\n');
  writeFileSync(path.join(dir, 'labels.json'), 'invalid json');
  const lines = [];
  const reason = 'relevance judgment failed: upstream_http 429';
  const input = {
    records, settings: settings(dir, { maxQuestions: 1, labelBudget: 0, realBudget: 0 }),
    now: () => new Date('2026-10-03T19:30:00Z'), readDense: async () => dense, chat: fakeChat(), jevEvaluate,
    live: async () => ({ outcome: 'unavailable', loss: 'status', reason, ms: 42 }),
    log: (line) => lines.push(line),
  };
  const status = await runFlywheelNight(input);
  assert.equal(status.reason, 'budget_reached');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).live.reason, reason);
  const logFile = path.join(dir, 'runner-2026-10-03.log');
  const logged = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.equal(logged.length, 3);
  assert.equal(logged[0], `2026-10-03T19:30:00.000Z hermes retrieval flywheel live id=a1 outcome=unavailable loss=status reason="${reason}" ms=42`);
  assert.deepEqual(logged.slice(1), lines.map((line) => `2026-10-03T19:30:00.000Z ${line}`));
  assert.equal(statSync(logFile).mode & 0o777, 0o600);
  assert.equal(existsSync(path.join(dir, 'runner-2026-10-04.log')), false);
  await runFlywheelNight(input);
  assert.equal(readFileSync(logFile, 'utf8').trim().split('\n').length, 4);
});

test('idle status lines are quiet until the reason changes, while work and console lines remain logged', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const lines = [];
  let time = new Date('2026-10-03T21:00:00Z');
  const input = { records, settings: settings(dir, { maxQuestions: 0 }), now: () => time,
    readDense: async () => dense, chat: fakeChat(), jevEvaluate, live: liveShown, log: (line) => lines.push(line) };
  const logFile = path.join(dir, 'runner-2026-10-03.log');
  await runFlywheelNight(input);
  time = new Date('2026-10-03T21:05:00Z');
  await runFlywheelNight(input);
  assert.equal(readFileSync(logFile, 'utf8').trim().split('\n').length, 1);
  assert.match(readFileSync(logFile, 'utf8'), /reason=outside_window/u);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'flywheel-status.json'), 'utf8')).updatedAt, time.toISOString());
  assert.equal(lines.length, 2);

  time = night();
  await runFlywheelNight(input);
  await runFlywheelNight(input);
  assert.equal(readFileSync(logFile, 'utf8').trim().split('\n').length, 2);
  assert.match(readFileSync(logFile, 'utf8'), /reason=budget_reached/u);
  writeFileSync(questionsPath(dir, '2026-10-03'), JSON.stringify({ a: 'a1', question: 'キズ', kept: true }) + '\n');
  const worked = await runFlywheelNight(input);
  assert.equal(worked.reason, 'budget_reached');
  assert.equal(worked.shown, 1);
  const logged = readFileSync(logFile, 'utf8').trim().split('\n');
  assert.equal(logged.length, 4);
  assert.match(logged[2], /flywheel live id=a1/u);
  assert.match(logged[3], /reason=budget_reached .*shown=1/u);
  assert.equal(lines.length, 5);
});

test('an unreadable previous status does not suppress an idle status line', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const input = { records, settings: settings(dir), now: () => new Date('2026-10-03T21:00:00Z'), log: () => {} };
  for (const stored of ['invalid json', 'null', '{}']) {
    writeFileSync(path.join(dir, 'flywheel-status.json'), stored);
    assert.equal((await runFlywheelNight(input)).reason, 'outside_window');
  }
  assert.equal(readFileSync(path.join(dir, 'runner-2026-10-03.log'), 'utf8').trim().split('\n').length, 3);
});

test('a failed readiness probe leaves anchors unused and the next successful probe generates normally', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const lines = [];
  const chat = fakeChat();
  const input = { records, settings: settings(dir, { maxQuestions: 2 }), now: night, readDense: async () => dense,
    chat, jevEvaluate, live: liveShown, seed: 7, log: (line) => lines.push(line) };
  let probes = 0;
  const probe = async (rawChat) => {
    assert.equal(rawChat, chat);
    probes += 1;
    return { ok: false, reason: 'http_503' };
  };
  const status = await runFlywheelNight({ ...input, probe });
  assert.equal(status.reason, 'dgx_not_ready');
  assert.deepEqual(status.probe, { ok: false, reason: 'http_503' });
  assert.equal(status.generated, 0);
  assert.equal(status.dropped, 0);
  assert.equal(existsSync(questionsPath(dir, '2026-10-03')), false);
  assert.deepEqual(await usedAnchors(dir), new Set());
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'flywheel-status.json'), 'utf8')), status);
  assert.equal(lines[0], 'hermes retrieval flywheel dgx not ready reason=http_503');
  await runFlywheelNight({ ...input, probe });
  assert.equal(probes, 2);
  const logged = readFileSync(path.join(dir, 'runner-2026-10-03.log'), 'utf8');
  assert.equal(logged.match(/dgx not ready reason=http_503/gu).length, 2);
  assert.equal(logged.match(/reason=dgx_not_ready/gu).length, 1);
  const ready = await runFlywheelNight(input);
  assert.equal(ready.reason, 'completed');
  assert.deepEqual(ready.probe, { ok: true });
  assert.equal(ready.generated, 2);
  assert.equal(ready.kept, 2);
  assert.equal(ready.shown, 2);
  assert.equal((await usedAnchors(dir)).size, 2);
});

test('a readiness probe is not run without a generation budget or unused candidate anchors', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  const input = { records, settings: settings(dir, { maxQuestions: 0 }), now: night, readDense: async () => dense,
    chat: fakeChat(), jevEvaluate, probe: async () => assert.fail('nothing to generate'), log: () => {} };
  assert.equal((await runFlywheelNight(input)).reason, 'budget_reached');
  writeFileSync(questionsPath(dir, '2026-10-02'), records.map((record) => JSON.stringify({ a: record.id.replace('nonconformity:', '') })).join('\n') + '\n');
  assert.equal((await runFlywheelNight({ ...input, settings: settings(dir) })).reason, 'no_pairs');
  assert.equal((await runFlywheelNight({ ...input, settings: settings(dir), readDense: async () => [] })).reason, 'no_pairs');
});

test('a night log write failure does not abort scoring or change the callback', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-'));
  mkdirSync(path.join(dir, 'runner-2026-10-03.log'));
  writeFileSync(questionsPath(dir, '2026-10-03'), JSON.stringify({ a: 'a1', question: 'キズ', kept: true }) + '\n');
  const lines = [];
  const status = await runFlywheelNight({ records, settings: settings(dir, { maxQuestions: 1, labelBudget: 0, realBudget: 0 }),
    now: night, readDense: async () => dense, chat: fakeChat(), jevEvaluate, live: liveShown, log: (line) => lines.push(line) });
  assert.equal(status.reason, 'budget_reached');
  assert.equal(status.shown, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^hermes retrieval flywheel reason=budget_reached /u);
});

test('settings default to off, cap the nightly budget, and follow the enrichment window', () => {
  const off = flywheelSettings({});
  assert.equal(off.enabled, false);
  assert.equal(off.maxQuestions, DEFAULT_MAX_QUESTIONS);
  assert.equal(off.labelBudget, 60);
  assert.equal(off.realBudget, 20);
  assert.equal(off.learnBudget, 30);
  assert.equal(flywheelSettings({ HERMES_FLYWHEEL_LEARN_BUDGET: '9999' }).learnBudget, 100);
  assert.equal(flywheelSettings({ HERMES_FLYWHEEL_LEARN_BUDGET: '0' }).learnBudget, 0);
  for (const value of ['x', '', ' ', '-1', '1.5', '30junk']) {
    assert.equal(flywheelSettings({ HERMES_FLYWHEEL_LEARN_BUDGET: value }).learnBudget, 30);
  }
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
  assert.match(logs[0], / pending=0 labelled=0 labelPending=0 real=0 learned=0\/pending$/u);
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

test('probe failure still backfills, labels and processes real questions with a fresh guard', async () => {
  const { dir, input } = realFixture({ maxQuestions: 2, labelBudget: 1 });
  const file = questionsPath(dir, '2026-10-03');
  writeFileSync(file, JSON.stringify({ a: 'a1', question: 'キズ', kept: true }) + '\n');
  const status = await runFlywheelNight({ ...input,
    probe: async () => ({ ok: false, reason: 'timeout' }),
    live: async (row) => row.a === null ? input.live(row) : { ...await liveShown(row), shown: ['b1'], loss: 'other_shown' },
  });
  assert.equal(status.reason, 'dgx_not_ready');
  assert.equal(status.generated, 0);
  assert.equal(status.dropped, 0);
  assert.equal(status.labelled, 1);
  assert.equal(status.shown, 1);
  assert.equal(status.real, 1);
  assert.equal(status.realPending, 0);
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 1);
});

test('real content questions get consensus labels and corrected loss once across starts and nights', async () => {
  const { dir, input } = realFixture();
  const logs = [];
  const status = await runFlywheelNight({ ...input, log: (line) => logs.push(line) });
  const file = realPath(dir, '2026-10-03');
  const rows = readRealRows(readFileSync(file, 'utf8'));
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.source, 'real');
  assert.equal(row.kind, 'content');
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
  assert.match(logs[0], / real=1 learned=0\/pending$/u);
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

test('real filter questions are checked deterministically without either grader', async () => {
  for (const [shown, extraPlan, expectedLoss] of [
    [['nonconformity:a1', 'b1'], {}, null],
    [['b1', 'a1'], {}, 'filter_mismatch'],
    [['a1', 'b1'], { filters: [{ field: 'discoveredOn', op: 'gte', values: ['2026-10-01'] }] }, 'filter_unsupported'],
  ]) {
    const { dir, input } = realFixture();
    const plan = { filters: [{ field: 'originDepartmentName', op: 'eq', values: ['North Shop'] }], semanticQuery: '', sort: { field: 'discoveredOn', direction: 'desc' }, limit: 2, ...extraPlan };
    const status = await runFlywheelNight({ ...input,
      records: records.map((record, index) => ({ ...record, discoveredOn: `2026-10-0${6 - index}` })),
      live: async () => ({ outcome: 'answer', shown, candidates: ['a1', 'b1', 'c1'], judged: 30, loss: 'other_shown', vectorStatus: 'not_requested', ms: 1, plan }),
      chat: async () => assert.fail('filter questions must not call DGX grading'),
      jevEvaluate: async () => assert.fail('filter questions must not call JEV grading'),
    });
    const [row] = readRealRows(readFileSync(realPath(dir, '2026-10-03'), 'utf8'));
    assert.equal(row.kind, 'filter');
    assert.deepEqual(row.relevant, []);
    assert.deepEqual(row.labels, {});
    assert.equal(row.filterCheck.supported, expectedLoss !== 'filter_unsupported');
    assert.equal(row.filterCheck.ok, expectedLoss === null ? true : expectedLoss === 'filter_mismatch' ? false : null);
    assert.equal(row.live.loss, expectedLoss);
    assert.deepEqual(row.live.plan, plan);
    assert.equal(status.real, 1);
    assert.equal(status.realPending, 0);
    assert.equal(existsSync(path.join(dir, 'labels.json')), false);
    const again = await runFlywheelNight({ ...input, live: async () => assert.fail('filter question already processed') });
    assert.equal(again.real, 0);
  }
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

function learnFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-learn-runner-'));
  const ids = Array.from({ length: 100 }, (_, index) => `rec-${index}`);
  const dev = ids.find((id) => splitOf(id) === 'dev');
  const heldout = ids.find((id) => splitOf(id) === 'heldout');
  const rows = [
    { a: dev, question: 'dev failure', kept: true, live: { loss: 'not_in_pool', shown: [] } },
    { a: heldout, question: 'heldout check', kept: true, live: { loss: null, shown: [heldout] } },
  ];
  writeFileSync(questionsPath(dir, '2026-10-03'), rows.map(JSON.stringify).join('\n') + '\n');
  return { dir, dev, heldout, rows, input: {
    records, settings: settings(dir, { maxQuestions: 2, learnBudget: 30, realBudget: 0 }), now: night,
    readDense: async () => dense, chat: async () => assert.fail('learning does not call DGX chat'),
    jevEvaluate: async () => assert.fail('fake learning scorer does not call JEV'), log: () => {},
  } };
}

test('probe failure still decides learned queries without adding synthetic rows', async () => {
  const { dir, heldout, rows, input } = learnFixture();
  const status = await runFlywheelNight({ ...input, settings: settings(dir, { maxQuestions: 3, learnBudget: 30, realBudget: 0 }),
    probe: async () => ({ ok: false, reason: 'http_503' }), live: async () => ({ shown: [heldout] }),
  });
  assert.equal(status.reason, 'dgx_not_ready');
  assert.equal(status.generated, 0);
  assert.equal(status.learned.proposed, 1);
  assert.equal(status.learned.decision, 'active');
  assert.equal(readFileSync(questionsPath(dir, '2026-10-03'), 'utf8'), rows.map(JSON.stringify).join('\n') + '\n');
});

test('stage five activates dev proposals when the injected live scorer gives equal results', async () => {
  const { dir, dev, heldout, rows, input } = learnFixture();
  const calls = [];
  const logs = [];
  const status = await runFlywheelNight({ ...input, live: async (row) => { calls.push(row.question); return { shown: [heldout] }; }, log: (line) => logs.push(line) });
  const learned = await readLearned(learnedPath(dir));
  assert.equal(learned.length, 1);
  assert.equal(learned[0].recordId, dev);
  assert.equal(learned[0].state, 'active');
  assert.equal(learned[0].query, 'dev failure');
  assert.ok(learned[0].decidedAt);
  assert.deepEqual(status.learned, { proposed: 1, candidates: 1, decision: 'active', check: { heldout: { n: 1, gained: 0, lost: 0 }, real: { n: 0, gained: 0, lost: 0 } } });
  assert.deepEqual(calls, ['heldout check', 'heldout check']);
  assert.match(logs[0], / learned=1\/active$/u);
  assert.equal(statSync(learnedPath(dir)).mode & 0o777, 0o600);
  assert.equal(readFileSync(questionsPath(dir, '2026-10-03'), 'utf8'), rows.map(JSON.stringify).join('\n') + '\n');
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'flywheel-status.json'), 'utf8')).learned, status.learned);
  const again = await runFlywheelNight({ ...input, live: async () => assert.fail('no candidates should not be scored') });
  assert.deepEqual(again.learned, { proposed: 0, candidates: 0, decision: null, check: null });
});

test('stage five rejects the whole candidate batch when heldout loses a relevant result', async () => {
  const { dir, heldout, input } = learnFixture();
  const factories = [];
  const status = await runFlywheelNight({ ...input, liveFactory: async ({ learned }) => {
    factories.push(learned);
    return async () => ({ shown: learned ? [] : [heldout] });
  } });
  assert.equal(factories.length, 2);
  assert.equal(factories[0], undefined);
  assert.equal(factories[1].length, 1);
  assert.equal(status.learned.decision, 'rejected');
  assert.deepEqual(status.learned.check.heldout, { n: 1, gained: 0, lost: 1 });
  assert.equal((await readLearned(learnedPath(dir)))[0].state, 'rejected');
});

test('stage five reads three nights, learns only dev rows, and checks heldout real losses separately', async () => {
  const { dir, dev, heldout, input } = learnFixture();
  const oldHeldout = Array.from({ length: 100 }, (_, index) => `rec-${index}`).find((id) => id !== heldout && splitOf(id) === 'heldout');
  writeFileSync(questionsPath(dir, '2026-10-01'), JSON.stringify({ a: oldHeldout, question: 'old heldout', kept: true, live: { loss: null } }) + '\n');
  writeFileSync(realPath(dir, '2026-10-02'), [
    { source: 'real', id: 'r-dev', split: 'dev', relevant: ['real-dev'], question: 'real dev failure', live: { loss: 'judge_rejected' } },
    { source: 'real', id: 'r-heldout', split: 'heldout', relevant: ['real-heldout'], question: 'real heldout check', live: { loss: null } },
  ].map(JSON.stringify).join('\n') + '\n');
  writeFileSync(realPath(dir, '2026-09-30'), JSON.stringify({ source: 'real', id: 'too-old', split: 'heldout', relevant: [heldout], question: 'too old' }) + '\n');
  writeFileSync(questionsPath(dir, '2026-09-30'), JSON.stringify({ a: dev, question: 'too old failure', kept: true, live: { loss: 'not_in_pool' } }) + '\n');
  const calls = [];
  const status = await runFlywheelNight({ ...input, liveFactory: async ({ learned }) => async ({ question }) => {
    calls.push(question);
    return { shown: question === 'real heldout check' ? learned ? [] : ['real-heldout'] : learned ? [heldout, oldHeldout] : [] };
  } });
  assert.deepEqual(new Set(calls), new Set(['heldout check', 'real heldout check', 'old heldout']));
  assert.deepEqual(status.learned.check, { heldout: { n: 3, gained: 2, lost: 1 }, real: { n: 1, gained: 0, lost: 1 } });
  assert.equal(status.learned.decision, 'rejected');
  const learned = await readLearned(learnedPath(dir));
  assert.deepEqual(learned.map((row) => row.recordId), [dev, 'real-dev']);
  assert.ok(learned.every((row) => row.state === 'rejected'));
});

test('stage five leaves candidates pending when the window expires and resumes without new proposals', async () => {
  const { dir, heldout, input } = learnFixture();
  const previous = { schema: LEARNED_SCHEMA, recordId: 'previous-target', query: 'previous query', from: 'r-previous', source: 'real', night: '2026-10-02', state: 'candidate', at: night().toISOString(), extra: 'preserved' };
  await writeLearned(learnedPath(dir), [previous]);
  let calls = 0;
  const pending = await runFlywheelNight({ ...input, now: () => calls === 0 ? night() : new Date('2026-10-03T21:00:00Z'),
    liveFactory: async () => async () => { calls += 1; return { shown: [heldout] }; },
  });
  assert.equal(calls, 1);
  assert.equal(pending.learned.decision, null);
  assert.equal(pending.learned.proposed, 1);
  assert.ok((await readLearned(learnedPath(dir))).every((row) => row.state === 'candidate' && !row.check && !row.decidedAt));
  const resumed = await runFlywheelNight({ ...input, liveFactory: async ({ learned }) => {
    if (learned) assert.equal(learned.length, 2);
    return async () => ({ shown: [heldout] });
  } });
  assert.equal(resumed.learned.proposed, 0);
  assert.equal(resumed.learned.candidates, 2);
  assert.equal(resumed.learned.decision, 'active');
  assert.equal((await readLearned(learnedPath(dir)))[0].extra, 'preserved');
});

test('the runner lock admits one holder, takes over dead or stale holders, and releases', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-lock-'));
  const alive = (pid) => pid === 111;
  const t0 = new Date('2026-10-06T13:00:00Z');
  const first = await acquireRunnerLock(dir, { pid: 111, now: () => t0, alive });
  assert.ok(first);
  // A second live holder is refused.
  assert.equal(await acquireRunnerLock(dir, { pid: 222, now: () => new Date(t0.getTime() + 60_000), alive }), null);
  // A dead holder is taken over.
  const dead = await acquireRunnerLock(dir, { pid: 333, now: () => new Date(t0.getTime() + 60_000), alive: () => false });
  assert.ok(dead);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'runner.lock'), 'utf8')).pid, 333);
  // A stale holder is taken over even when its process looks alive.
  const stale = await acquireRunnerLock(dir, { pid: 444, now: () => new Date(t0.getTime() + 3 * 3600 * 1000), alive: () => true });
  assert.ok(stale);
  await stale.release();
  const again = await acquireRunnerLock(dir, { pid: 555, now: () => t0, alive });
  assert.ok(again);
  await again.release();
});
