import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { splitOf } from './flywheel-gate.mjs';
import { DEFAULT_LEARN_BUDGET, LEARN_BUDGET_CAP, LEARN_EVAL_NIGHTS, LEARNED_SCHEMA, activationDecision, evaluateCandidates, learnedPath, learnedPathFromEnv, learnedQueriesById, mergeLearnedQueries, proposeLearnedQueries, readLearned, writeLearned } from './flywheel-learn.mjs';

const night = '2026-10-03';
const ids = Array.from({ length: 100 }, (_, i) => `rec-${i}`);
const dev = ids.find((id) => splitOf(id) === 'dev');
const heldout = ids.find((id) => splitOf(id) === 'heldout');
const synthetic = (extra = {}) => ({ a: `nonconformity:${dev}`, question: '工具がぐらぐら', kept: true, live: { loss: 'not_in_pool' }, ...extra });
const real = (extra = {}) => ({ source: 'real', id: 'r-abc', split: 'dev', relevant: ['nonconformity:real-target', 'other'], question: '机ががたつく', live: { loss: 'judge_rejected' }, ...extra });

test('filter rows cannot propose learned queries or enter synthetic held-out comparisons', async () => {
  assert.deepEqual(proposeLearnedQueries({ rows: [synthetic({ kind: 'filter' }), real({ kind: 'filter' })], night }), []);
  const check = await evaluateCandidates({ questions: [{ kind: 'filter', source: 'synthetic', split: 'heldout', relevant: ['a'], question: 'department' }],
    scoreBaseline: async () => assert.fail('filter excluded'), scoreCandidate: async () => assert.fail('filter excluded') });
  assert.deepEqual(check, { heldout: { n: 0, gained: 0, lost: 0 }, real: { n: 0, gained: 0, lost: 0 } });
});

test('proposals use dev failures, the first relevant id, and only the two learnable losses', () => {
  const rows = [synthetic(), real(), synthetic({ kept: false }), synthetic({ a: heldout }), real({ split: 'heldout' }), real({ relevant: [] }),
    synthetic({ a: null }), synthetic({ question: ' ' }), ...[null, 'other_shown', 'status', 'failed'].map((loss) => synthetic({ live: { loss } }))];
  const proposals = proposeLearnedQueries({ rows, night });
  assert.equal(proposals.length, 2);
  assert.deepEqual(proposals.map(({ at, ...row }) => row), [
    { schema: LEARNED_SCHEMA, recordId: dev, query: '工具がぐらぐら', source: 'synthetic', from: dev, night, state: 'candidate' },
    { schema: LEARNED_SCHEMA, recordId: 'real-target', query: '机ががたつく', source: 'real', from: 'r-abc', night, state: 'candidate' },
  ]);
  assert.ok(proposals.every((row) => !Number.isNaN(Date.parse(row.at))));
  assert.equal(proposeLearnedQueries({ rows: [synthetic({ a: null, b: dev, grades: { dgx: { b: 3 }, jev: { b: 2 } } })], night }).length, 0);
});

test('the synthetic split agrees with the gate for prefixed, bare, and Unicode anchors', () => {
  for (const id of [...ids, '記録一', 'あいう', '😀', '']) {
    const proposals = proposeLearnedQueries({ rows: [synthetic({ a: `nonconformity:${id}`, split: splitOf(id) === 'dev' ? 'heldout' : 'dev' })], night });
    assert.equal(proposals.length, id && splitOf(id) === 'dev' ? 1 : 0, id);
  }
});

test('proposals deduplicate NFKC queries by record across all states and within the batch, and respect budget', () => {
  const rows = [synthetic({ question: 'ＡＢＣ' }), synthetic({ question: 'ABC' }), real({ question: 'ABC' }), synthetic({ question: 'new' })];
  assert.equal(proposeLearnedQueries({ rows, night }).length, 3);
  for (const state of ['candidate', 'active', 'rejected']) {
    const existing = [{ recordId: dev, query: 'ABC', state }];
    assert.deepEqual(proposeLearnedQueries({ rows, existing, night, budget: 1 }).map((row) => row.recordId), ['real-target']);
  }
  assert.deepEqual(proposeLearnedQueries({ rows, night, budget: 0 }), []);
  assert.equal(DEFAULT_LEARN_BUDGET, 30);
  assert.equal(LEARN_BUDGET_CAP, 100);
  assert.equal(LEARN_EVAL_NIGHTS, 3);
});

test('learned query maps normalize ids, deduplicate NFKC queries, select states and leave rows unchanged', () => {
  const rows = [
    { recordId: 'nonconformity:a', query: 'ＡＢＣ', state: 'active' },
    { recordId: 'a', query: 'ABC', state: 'active' },
    { recordId: 'a', query: 'next', state: 'active' },
    { recordId: 'b', query: 'pending', state: 'candidate' },
    { recordId: 'a', query: 'rejected', state: 'rejected' },
    { recordId: '', query: 'invalid', state: 'active' },
    { recordId: 'a', query: ' ', state: 'active' },
    { recordId: 'a', query: null, state: 'active' },
  ];
  const snapshot = structuredClone(rows);
  assert.deepEqual(learnedQueriesById(rows), new Map([['a', ['ＡＢＣ', 'next']]]));
  assert.deepEqual(learnedQueriesById(rows, { states: ['candidate'] }), new Map([['b', ['pending']]]));
  assert.deepEqual(learnedQueriesById(rows, { states: ['active', 'candidate'] }), new Map([['a', ['ＡＢＣ', 'next']], ['b', ['pending']]]));
  assert.deepEqual(learnedQueriesById(rows, { states: null }), new Map([['a', ['ＡＢＣ', 'next', 'rejected']], ['b', ['pending']]]));
  assert.deepEqual(learnedQueriesById([]), new Map());
  assert.deepEqual(rows, snapshot);
});

test('merge appends distinct queries without mutating the store or learned rows and selects states', () => {
  const stored = { schema: 'hermes-retrieval-enrichment/v1', recordId: dev, summary: 'summary', queries: ['ABC'], facets: {} };
  const original = new Map([[dev, stored]]);
  const learned = [{ recordId: dev, query: 'ＡＢＣ', state: 'active' }, { recordId: dev, query: 'new', state: 'active' },
    { recordId: 'missing', query: 'added', state: 'candidate' }, { recordId: dev, query: 'rejected', state: 'rejected' }];
  const snapshot = structuredClone({ original, learned });
  const merged = mergeLearnedQueries(original, learned);
  assert.deepEqual(merged.get(dev).queries, ['ABC', 'new']);
  assert.equal(merged.get(dev).summary, 'summary');
  assert.equal(merged.has('missing'), false);
  assert.deepEqual({ original, learned }, snapshot);
  assert.notEqual(merged, original);
  assert.notEqual(merged.get(dev), stored);
  const candidates = mergeLearnedQueries(null, learned, { states: ['candidate'] });
  assert.deepEqual(candidates.get('missing'), { schema: 'hermes-retrieval-enrichment/v1', recordId: 'missing', queries: ['added'] });
  assert.equal(mergeLearnedQueries(original, learned, { states: ['active', 'candidate'] }).has('missing'), true);
  assert.equal(mergeLearnedQueries(null, learned, { states: null }).get(dev).queries.includes('rejected'), true);
});

test('evaluation counts relevant shown transitions, including real rows in both counts', async () => {
  const questions = [
    { question: 'gain', relevant: ['a'], source: 'synthetic' },
    { question: 'loss', relevant: ['a'], source: 'real' },
    { question: 'keep', relevant: ['a', 'b'], source: 'real' },
    { question: 'miss', relevant: ['a'], source: 'synthetic' },
    { question: 'real gain', relevant: ['a'], source: 'real' },
  ];
  const score = (shown) => async (row) => {
    assert.deepEqual(Object.keys(row), ['a', 'b', 'question', 'grades']);
    assert.equal(row.a, null);
    return { shown: shown[row.question] ?? [] };
  };
  const check = await evaluateCandidates({ questions,
    scoreBaseline: score({ loss: ['a'], keep: ['b'], miss: ['other'] }),
    scoreCandidate: score({ gain: ['nonconformity:a'], keep: ['a'], miss: ['other'], 'real gain': ['a'] }),
  });
  assert.deepEqual(check, { heldout: { n: 5, gained: 2, lost: 1 }, real: { n: 3, gained: 1, lost: 1 } });
  assert.equal(activationDecision(check), 'active');
  assert.equal(activationDecision({ ...check, real: { n: 3, gained: 0, lost: 1 } }), 'rejected');
  assert.equal(activationDecision({ ...check, heldout: { n: 5, gained: 0, lost: 1 } }), 'rejected');
  const empty = await evaluateCandidates({ questions: [], scoreBaseline: score({}), scoreCandidate: score({}) });
  assert.equal(activationDecision(empty), 'active');
});

test('learned rows round-trip atomically at mode 0600 and missing or malformed lines are skipped', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flywheel-learn-'));
  const file = learnedPath(dir);
  assert.equal(learnedPathFromEnv({}), '/app/storage/hermes-search/runtime/flywheel/learned-queries.jsonl');
  assert.equal(learnedPathFromEnv({ HERMES_FLYWHEEL_LEARNED_PATH: file }), file);
  assert.deepEqual(await readLearned(file), []);
  const rows = proposeLearnedQueries({ rows: [synthetic(), real()], night });
  rows[1] = { ...rows[1], state: 'active', check: { heldout: { n: 1, gained: 0, lost: 0 }, real: { n: 0, gained: 0, lost: 0 } }, decidedAt: '2026-10-04T00:00:00Z', extra: 'preserved' };
  await writeLearned(file, rows);
  assert.deepEqual(await readLearned(file), rows);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const contents = await readFile(file, 'utf8');
  await writeFile(file, `broken\nnull\n{}\n${JSON.stringify({ ...rows[0], state: 'bad' })}\n${contents}`);
  assert.deepEqual(await readLearned(file), rows);
  await writeLearned(file, []);
  assert.deepEqual(await readLearned(file), []);
});
