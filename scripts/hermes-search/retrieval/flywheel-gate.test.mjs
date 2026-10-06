import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ALPHA, DEV_SHARE, MIN_DEV_NET, compareRuns, decide, formatGate, parseGateArgs, questionSet, signTest, splitOf } from './flywheel-gate.mjs';
import { parseRunArgs, runCases, scorerEnv } from './flywheel-run.mjs';

const kept = (a, b, extra = {}) => ({ a, b, seed: { style: 'terse' }, question: `q ${a}`, kept: true, reason: null, grades: { dgx: { a: 3, b: 1 }, jev: { a: 3, b: 1 } }, ...extra });

test('question sets include supported real filters and retain legacy content questions', () => {
  const plan = { filters: [], semanticQuery: '', sort: 'recent', limit: 2 };
  const filter = { source: 'real', kind: 'filter', id: 'r-filter', question: 'recent two', split: 'dev', relevant: [], live: { plan }, filterCheck: { supported: true, ok: false } };
  const questions = questionSet([filter, filter,
    { ...filter, id: 'unsupported', relevant: ['a'], filterCheck: { supported: false } },
    { ...filter, id: 'unchecked', filterCheck: undefined },
    { ...filter, id: 'empty', question: '' },
    { source: 'real', id: 'r-content', question: 'scratch', split: 'heldout', relevant: ['a'] },
    kept('a', 'b'),
  ]);
  assert.deepEqual(questions[0], { id: 'r-filter', question: 'recent two', split: 'dev', relevant: [], seed: null, source: 'real', kind: 'filter', plan });
  assert.deepEqual(questions.map((row) => [row.id, row.kind]), [['r-filter', 'filter'], ['r-content', 'content'], ['a', 'content']]);
});

test('filter comparisons use checks across real and both splits, skipping old or unsupported cases', () => {
  const questions = ['d', 'h', 'old', 'unsupported', 'missing'].map((id) => ({ id, source: 'real', kind: 'filter', split: id === 'd' ? 'dev' : 'heldout', relevant: [] }));
  const baseline = { cases: [
    { id: 'd', shown: ['a'], filterCheck: { supported: true, ok: false } },
    { id: 'h', shown: [], filterCheck: { supported: true, ok: true } },
    { id: 'old', shown: ['a'] },
    { id: 'unsupported', filterCheck: { supported: false, ok: null } },
  ] };
  const candidate = { cases: questions.map(({ id }) => ({ id, shown: [], filterCheck: { supported: true, ok: id !== 'h' } })) };
  const comparison = compareRuns({ questions, baseline, candidate, labels: { d: { a: { g: 3 } } } });
  assert.deepEqual(comparison.real, { n: 2, skipped: 3, baselineShown: 1, candidateShown: 1, gained: 1, lost: 1, p: 1 });
  assert.equal(comparison.dev.gained, 1);
  assert.equal(comparison.heldout.lost, 1);
  assert.equal(comparison.heldout.skipped, 3);
  assert.deepEqual(comparison.dev.gainedIds, ['d']);
  assert.deepEqual(comparison.heldout.lostIds, []);
});

test('offline filter checks use each run plan and shown ids with the supplied corpus and catalog', async () => {
  const catalog = { id: 'nonconformity', fields: [{ key: 'date', role: 'date' }] };
  const records = [{ id: 'a', department: 'North', date: '2026-10-06' }, { id: 'b', department: 'South', date: '2026-10-07' }];
  const plan = { filters: [{ field: 'department', op: 'eq', values: ['North'] }], semanticQuery: '', sort: { field: 'date', direction: 'desc' }, limit: 2 };
  const questions = [{ id: 'r-filter', kind: 'filter', source: 'real', split: 'dev', question: 'North records', relevant: [], plan: { ...plan, filters: [] } }];
  const score = async () => ({ plan, shown: ['nonconformity:a'], outcome: 'answer', loss: 'other_shown', candidates: ['a'], vectorStatus: 'not_requested', ms: 1 });
  const run = await runCases({ questions, records, catalog, score });
  assert.equal(run.skipped, 0);
  assert.deepEqual(run.cases[0].filterCheck, { supported: true, filtersOk: true, orderOk: true, countOk: true, ok: true, expectedIds: ['a'], shown: ['a'], matchedCount: 1 });
  const wrong = await runCases({ questions, records, catalog, score: async () => ({ ...await score(), shown: ['b'] }) });
  assert.equal(wrong.cases[0].filterCheck.ok, false);
  const unsupported = await runCases({ questions, records, catalog, score: async () => ({ ...await score(), plan: null }) });
  assert.equal(unsupported.cases[0].filterCheck.ok, null);
});

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
  const real = { id: 'r-abc', split: 'dev', question: 'real q', relevant: ['d1'], source: 'real' };
  const asked = [];
  const score = async (row) => {
    asked.push(row.question);
    return { outcome: 'answer', shown: [row.a], candidates: [row.a], judged: 30, loss: null, vectorStatus: 'ok', ms: 3 };
  };
  const dev = await runCases({ questions: [...questions, real], records, score, split: 'dev' });
  assert.deepEqual(asked, ['q1', 'real q']);
  assert.equal(dev.skipped, 1);
  assert.deepEqual(dev.cases.map((entry) => [entry.id, entry.loss]), [['d1', null], ['r-abc', null]]);
  const all = await runCases({ questions, records, score, split: 'all', limit: 1 });
  assert.equal(all.cases.length, 1);

  const options = parseRunArgs(['--snapshot', 's.json', '--questions', 'a.jsonl', 'b.jsonl', '--out', 'o.json', '--dense', 'd.bin', '--enrichment', 'e.jsonl', '--pool', '15', '--split', 'heldout']);
  assert.deepEqual(options.questions, ['a.jsonl', 'b.jsonl']);
  const env = scorerEnv(options, { HERMES_INFERENCE_ORIGIN: 'http://dgx', HERMES_INFERENCE_TOKEN: 't' });
  assert.deepEqual(env, {
    HERMES_RETRIEVAL_DENSE_PROVIDER: 'dgx',
    HERMES_RETRIEVAL_ENRICHMENT_ENABLED: 'true',
    HERMES_FLYWHEEL_LEARNED_ENABLED: 'false',
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

test('offline run parses learned path or off and disables implicit production learned loading', () => {
  const args = ['--snapshot', 's', '--questions', 'a', '--out', 'o'];
  assert.equal(parseRunArgs(args).learned, 'off');
  assert.equal(parseRunArgs([...args, '--learned', 'off']).learned, 'off');
  const options = parseRunArgs([...args, '--learned', 'learned-queries.jsonl']);
  assert.equal(options.learned, 'learned-queries.jsonl');
  assert.equal(scorerEnv(options).HERMES_FLYWHEEL_LEARNED_ENABLED, 'false');
  assert.throws(() => parseRunArgs([...args, '--learned']), /--learned/u);
  assert.throws(() => parseRunArgs([...args, '--learned', '--dense', 'off']), /--learned/u);
});

test('real questions join synthetic rows, preserve stored splits, and exclude unknown relevance', () => {
  const real = { source: 'real', id: 'r-abc', question: '現場の質問', split: 'heldout', relevant: ['a1'] };
  const questions = questionSet([kept('a1', 'b1'), real, { ...real, question: 'duplicate' }, { ...real, id: 'r-empty', relevant: [] }]);
  assert.equal(questions.length, 2);
  assert.equal(questions[0].source, 'synthetic');
  assert.deepEqual(questions[1], { id: 'r-abc', question: '現場の質問', split: 'heldout', relevant: ['a1'], seed: null, source: 'real', kind: 'content' });
});

test('real comparison combines splits, counts skips, uses labels, and reports no held-out ids', () => {
  const questions = [
    { id: 'r-d', source: 'real', split: 'dev', relevant: ['a1'] },
    { id: 'r-h', source: 'real', split: 'heldout', relevant: ['b1'] },
    { id: 'r-skip', source: 'real', split: 'heldout', relevant: ['c1'] },
    { id: 'synthetic', source: 'synthetic', split: 'dev', relevant: ['s1'] },
  ];
  const comparison = compareRuns({ questions,
    baseline: { cases: [{ id: 'r-d', shown: [] }, { id: 'r-h', shown: ['nonconformity:b1'] }, { id: 'synthetic', shown: [] }] },
    candidate: { cases: [{ id: 'r-d', shown: ['labelled'] }, { id: 'r-h', shown: [] }, { id: 'r-skip', shown: [] }, { id: 'synthetic', shown: ['s1'] }] },
    labels: { 'r-d': { labelled: { g: 3 } } },
  });
  assert.deepEqual(comparison.real, { n: 2, skipped: 1, baselineShown: 1, candidateShown: 1, gained: 1, lost: 1, p: 1 });
  assert.equal(comparison.dev.n, 2);
  assert.equal(comparison.dev.gained, 2);
  assert.equal(comparison.heldout.n, 1);
  assert.equal(comparison.heldout.lost, 1);
  assert.equal(comparison.heldout.skipped, 1);
  const formatted = formatGate(comparison, decide(comparison));
  assert.match(formatted, /held-out:.*\n  real: n 2, relevant shown 1 -> 1, gained 1, lost 1, p 1\.000, skipped 1/u);
  assert.doesNotMatch(formatted, /r-h|r-skip/u);
});

test('a real net loss rejects otherwise passing splits; real ties and empty sets pass', () => {
  const comparison = { dev: { n: 5, gained: 4, lost: 1 }, heldout: { n: 3, gained: 1, lost: 1 }, real: { n: 2, gained: 0, lost: 1 } };
  assert.deepEqual(decide(comparison), { accept: false, reasons: ['real questions lost 1 and gained 0'] });
  comparison.real.gained = 1;
  assert.equal(decide(comparison).accept, true);
  comparison.real = { n: 0, gained: 0, lost: 1 };
  assert.equal(decide(comparison).accept, true);
  delete comparison.real;
  assert.equal(decide(comparison).accept, true);
});

test('gate CLI accepts real and synthetic JSONL files together', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'flywheel-gate-real-'));
  const realFile = path.join(dir, 'real-2026-10-03.jsonl');
  const syntheticFile = path.join(dir, 'questions-2026-10-03.jsonl');
  writeFileSync(realFile, JSON.stringify({ source: 'real', id: 'r-real', question: '傷', split: 'heldout', relevant: ['a1'] }) + '\nbroken\n');
  writeFileSync(syntheticFile, JSON.stringify(kept('a1', 'b1')) + '\n');
  const baseline = path.join(dir, 'baseline.json');
  const candidate = path.join(dir, 'candidate.json');
  for (const file of [baseline, candidate]) writeFileSync(file, JSON.stringify({ cases: [{ id: 'r-real', shown: ['a1'] }, { id: 'a1', shown: ['a1'] }] }));
  const cli = spawnSync(process.execPath, [new URL('./flywheel-gate.mjs', import.meta.url).pathname, '--questions', syntheticFile, realFile, '--baseline', baseline, '--candidate', candidate], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(cli.stdout, /questions 2 /u);
  assert.match(cli.stdout, /real: n 1, relevant shown 1 -> 1/u);
});
