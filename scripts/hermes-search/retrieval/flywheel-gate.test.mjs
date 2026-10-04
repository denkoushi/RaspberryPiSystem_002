import test from 'node:test';
import assert from 'node:assert/strict';
import { ALPHA, DEV_SHARE, MIN_DEV_NET, compareRuns, decide, formatGate, parseGateArgs, questionSet, signTest, splitOf } from './flywheel-gate.mjs';
import { parseRunArgs, runCases, scorerEnv } from './flywheel-run.mjs';

const kept = (a, b, extra = {}) => ({ a, b, seed: { style: 'terse' }, question: `q ${a}`, kept: true, reason: null, grades: { dgx: { a: 3, b: 1 }, jev: { a: 3, b: 1 } }, ...extra });

test('the split is fixed by the anchor id and lands near the development share', () => {
  assert.equal(splitOf('nonconformity:x1'), splitOf('x1'));
  const ids = Array.from({ length: 2000 }, (_, index) => `r${index}`);
  const dev = ids.filter((id) => splitOf(id) === 'dev').length / ids.length * 100;
  assert.ok(Math.abs(dev - DEV_SHARE) < 5, `development share ${dev}`);
});

test('the question set keeps one row per anchor with its relevant ids', () => {
  const rows = [
    kept('nonconformity:a1', 'b1'),
    kept('a1', 'b9'),
    kept('a2', 'b2', { grades: { dgx: { a: 3, b: 3 }, jev: { a: 3, b: 3 } } }),
    { a: 'a3', b: 'b3', question: 'dropped', kept: false, reason: 'copied_run' },
  ];
  const questions = questionSet(rows);
  assert.deepEqual(questions.map((item) => item.id), ['a1', 'a2']);
  assert.deepEqual(questions[1].relevant, ['a2', 'b2']);
  assert.ok(['dev', 'heldout'].includes(questions[0].split));
});

test('the sign test matches the values in the accuracy log', () => {
  assert.equal(signTest(0, 0), 1);
  assert.equal(signTest(5, 0), 0.0625);
  assert.equal(signTest(3, 0), 0.25);
  assert.equal(signTest(4, 2), 0.6875);
  assert.ok(signTest(0, 8) < 0.01);
});

test('runs are compared per question on relevant shown, and the rule decides', () => {
  const questions = [
    { id: 'd1', split: 'dev', relevant: ['d1'] },
    { id: 'd2', split: 'dev', relevant: ['d2'] },
    { id: 'd3', split: 'dev', relevant: ['d3', 'n3'] },
    { id: 'h1', split: 'heldout', relevant: ['h1'] },
    { id: 'h2', split: 'heldout', relevant: ['h2'] },
    { id: 'h3', split: 'heldout', relevant: ['h3'] },
  ];
  const run = (shownById) => ({ cases: Object.entries(shownById).map(([id, shown]) => ({ id, shown })) });
  const baseline = run({ d1: ['d1'], d2: [], d3: ['x'], h1: ['h1'], h2: [], h3: ['h3'] });
  const better = run({ d1: ['d1'], d2: ['d2'], d3: ['n3'], h1: ['h1'], h2: ['h2'], h3: ['h3'] });
  const good = compareRuns({ questions, baseline, candidate: better });
  assert.deepEqual([good.dev.n, good.dev.baselineShown, good.dev.candidateShown, good.dev.gained, good.dev.lost], [3, 1, 3, 2, 0]);
  assert.deepEqual([good.heldout.gained, good.heldout.lost], [1, 0]);
  assert.deepEqual(good.dev.gainedIds, ['d2', 'd3']);
  assert.equal(decide(good, { minDevNet: 2 }).accept, true);
  assert.equal(decide(good).accept, false);

  // A development gain that costs held-out questions is rejected.
  const overfit = run({ d1: ['d1'], d2: ['d2'], d3: ['d3'], h1: [], h2: [], h3: [] });
  const many = [...questions, ...Array.from({ length: 4 }, (_, index) => ({ id: `h${index + 4}`, split: 'heldout', relevant: [`h${index + 4}`] }))];
  const wide = (shownById) => run({ ...shownById, h4: ['h4'], h5: ['h5'], h6: ['h6'], h7: ['h7'] });
  const bad = compareRuns({ questions: many, baseline: wide({ d1: ['d1'], d2: [], d3: [], h1: ['h1'], h2: ['h2'], h3: ['h3'] }), candidate: run({ ...Object.fromEntries(overfit.cases.map((entry) => [entry.id, entry.shown])), h4: [], h5: [], h6: [], h7: [] }) });
  assert.equal(bad.heldout.lost, 7);
  const rejected = decide(bad);
  assert.equal(rejected.accept, false);
  assert.match(rejected.reasons[0], /held-out lost 7/u);

  // No development gain is a rejection too, and unknown questions are skipped, not counted.
  const same = compareRuns({ questions, baseline, candidate: run({ d1: ['d1'], d2: [], h1: ['h1'], h3: ['h3'] }) });
  assert.equal(same.dev.skipped, 1);
  assert.equal(same.heldout.skipped, 1);
  assert.equal(decide(same).accept, false);
  assert.match(formatGate(good, decide(good, { minDevNet: 2 })), /held-out: n 3, relevant shown 2 -> 3, gained 1, lost 0, p 1\.000\n.*gained: d2, d3\n  gate: accept/su);
  assert.throws(() => parseGateArgs(['--baseline', 'a']), /usage/u);
});

test('the gate rejects development 3 versus 2 and held-out 1 versus 2 regardless of significance', () => {
  const devIds = ['d1', 'd2', 'd3', 'd4', 'd5'];
  const heldoutIds = ['h1', 'h2', 'h3'];
  const questions = [
    ...devIds.map((id) => ({ id, split: 'dev', relevant: [id] })),
    ...heldoutIds.map((id) => ({ id, split: 'heldout', relevant: [id] })),
  ];
  const run = (ids) => ({ cases: questions.map(({ id }) => ({ id, shown: ids.includes(id) ? [id] : [] })) });
  const comparison = compareRuns({ questions, baseline: run(['d4', 'd5', 'h2', 'h3']), candidate: run(['d1', 'd2', 'd3', 'h1']) });
  assert.deepEqual([comparison.dev.gained, comparison.dev.lost, comparison.heldout.gained, comparison.heldout.lost], [3, 2, 1, 2]);
  assert.ok(comparison.heldout.p > ALPHA);
  assert.equal(MIN_DEV_NET, 3);
  assert.deepEqual(decide(comparison), {
    accept: false,
    reasons: ['held-out lost 2 and gained 1', 'development net gain 1 is below 3'],
  });
  assert.equal(decide(comparison, { alpha: 0, minDevNet: 1 }).accept, false);
});

test('the default net threshold is inclusive, held-out ties pass, and no paired questions reject', () => {
  const result = (extra) => ({ n: 5, gained: 0, lost: 0, p: 1, ...extra });
  const comparison = { dev: result({ gained: 5, lost: 2 }), heldout: result({ gained: 1, lost: 1 }) };
  assert.equal(decide(comparison).accept, true);
  comparison.dev.gained = 4;
  assert.deepEqual(decide(comparison), { accept: false, reasons: ['development net gain 2 is below 3'] });
  const empty = compareRuns({ questions: [], baseline: {}, candidate: {} });
  assert.equal(decide(empty, { minDevNet: 0 }).accept, false);
  assert.ok(decide(empty).reasons.includes('no question was answered by both runs'));
});

test('shown labels count other_shown records as relevant in both runs and keep held-out ids private', () => {
  const questions = [
    ...['d1', 'd2', 'd3'].map((id) => ({ id, split: 'dev', question: `question ${id}`, relevant: [id] })),
    { id: 'private-heldout', split: 'heldout', question: 'private question', relevant: ['private-heldout'] },
  ];
  const baseline = { cases: questions.map(({ id }) => ({ id, shown: id === 'private-heldout' ? ['other-h'] : [] })) };
  const candidate = { cases: questions.map(({ id }) => ({ id, shown: id === 'private-heldout' ? [] : [`nonconformity:other-${id}`], loss: 'other_shown' })) };
  const unlabelled = compareRuns({ questions, baseline, candidate });
  assert.equal(unlabelled.dev.gained, 0);
  assert.equal(decide(unlabelled).accept, false);
  const labels = Object.fromEntries(['d1', 'd2', 'd3'].map((id) => [id, { [`other-${id}`]: { g: 3, p: [0, 0, 0, 1] } }]));
  const labelled = compareRuns({ questions, baseline, candidate, labels });
  assert.equal(labelled.dev.gained, 3);
  assert.equal(decide(labelled).accept, true);
  labels['private-heldout'] = { 'other-h': { g: 3, p: [0, 0, 0, 1] } };
  const withLoss = compareRuns({ questions, baseline, candidate, labels });
  assert.equal(withLoss.heldout.baselineShown, 1);
  assert.equal(withLoss.heldout.lost, 1);
  assert.equal(decide(withLoss).accept, false);
  const note = 'labels: labels.json (4 questions)';
  const formatted = formatGate(withLoss, decide(withLoss), { note });
  assert.ok(formatted.startsWith(`${note}\n`));
  assert.equal(formatted.includes('private-heldout'), false);
  assert.equal(formatted.includes('private question'), false);
  assert.deepEqual(withLoss.heldout.lostIds, []);
  assert.deepEqual(compareRuns({ questions, baseline, candidate, labels: {} }), unlabelled);
});

test('parseGateArgs adds an optional labels path while preserving existing arguments', () => {
  const args = ['--questions', 'a.jsonl', 'b.jsonl', '--baseline', 'a.json', '--candidate', 'b.json'];
  assert.deepEqual(parseGateArgs([...args, '--labels', 'labels.json']), {
    questions: ['a.jsonl', 'b.jsonl'], baseline: 'a.json', candidate: 'b.json', labels: 'labels.json',
  });
  assert.equal(parseGateArgs(args).labels, null);
  assert.throws(() => parseGateArgs([...args, '--labels']), /--labels/u);
  assert.throws(() => parseGateArgs([...args, '--labels', '--unknown']), /--labels/u);
});

test('the offline run answers one split, skips anchors missing from the snapshot, and selects the configuration', async () => {
  const questions = [
    { id: 'd1', split: 'dev', question: 'q1', relevant: ['d1'] },
    { id: 'd2', split: 'dev', question: 'q2', relevant: ['d2'] },
    { id: 'h1', split: 'heldout', question: 'q3', relevant: ['h1'] },
  ];
  const records = [{ id: 'nonconformity:d1' }, { id: 'h1' }];
  const asked = [];
  const score = async (row) => {
    asked.push(row.question);
    return { outcome: 'answer', shown: [row.a], candidates: [row.a], judged: 30, loss: null, vectorStatus: 'ok', ms: 3 };
  };
  const dev = await runCases({ questions, records, score, split: 'dev' });
  assert.deepEqual(asked, ['q1']);
  assert.equal(dev.skipped, 1);
  assert.deepEqual(dev.cases.map((entry) => [entry.id, entry.loss]), [['d1', null]]);
  const all = await runCases({ questions, records, score, split: 'all', limit: 1 });
  assert.equal(all.cases.length, 1);

  const options = parseRunArgs(['--snapshot', 's.json', '--questions', 'a.jsonl', 'b.jsonl', '--out', 'o.json', '--dense', 'd.bin', '--enrichment', 'e.jsonl', '--pool', '15', '--split', 'heldout']);
  assert.deepEqual(options.questions, ['a.jsonl', 'b.jsonl']);
  const env = scorerEnv(options, { HERMES_INFERENCE_ORIGIN: 'http://dgx', HERMES_INFERENCE_TOKEN: 't' });
  assert.deepEqual(env, {
    HERMES_RETRIEVAL_DENSE_PROVIDER: 'dgx',
    HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'true',
    HERMES_RETRIEVAL_DENSE_STORE: 'd.bin',
    HERMES_INFERENCE_ORIGIN: 'http://dgx',
    HERMES_INFERENCE_TOKEN: 't',
    HERMES_RETRIEVAL_ENRICHMENT_STORE: 'e.jsonl',
    HERMES_RETRIEVAL_RELEVANCE_POOL: '15',
  });
  assert.equal(scorerEnv(parseRunArgs(['--snapshot', 's', '--questions', 'a', '--out', 'o'])).HERMES_RETRIEVAL_DENSE_PROVIDER, 'off');
  assert.equal(scorerEnv(options, { HERMES_RETRIEVAL_DENSE_BASE_URL: 'http://127.0.0.1:38110' }).HERMES_RETRIEVAL_DENSE_BASE_URL, 'http://127.0.0.1:38110');
  assert.equal('HERMES_RETRIEVAL_DENSE_BASE_URL' in env, false);
  assert.throws(() => parseRunArgs(['--snapshot', 's', '--questions', 'a', '--out', 'o', '--split', 'x']), /--split/u);
});
