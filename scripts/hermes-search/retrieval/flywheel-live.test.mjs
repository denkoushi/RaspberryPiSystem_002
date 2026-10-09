import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LOSS_STAGES, createLiveScorer, lossStage, relevantIds } from './flywheel-live.mjs';
import { loadNonconformityCatalog } from './catalog.mjs';
import { records } from './fixtures/synthetic-records.mjs';
import { LEARNED_SCHEMA, learnedPath, learnedQueriesById, writeLearned } from './flywheel-learn.mjs';

const kept = { a: 'nonconformity:a1', b: 'nonconformity:b1', grades: { dgx: { a: 3, b: 1 }, jev: { a: 3, b: 2 } } };

test('relevant ids are the anchor, plus the near miss only when both graders confirm it', () => {
  assert.deepEqual(relevantIds(kept), ['a1']);
  assert.deepEqual(relevantIds({ ...kept, grades: { dgx: { a: 3, b: 3 }, jev: { a: 3, b: 3 } } }), ['a1', 'b1']);
  assert.deepEqual(relevantIds({ ...kept, grades: { dgx: { a: 3, b: 3 }, jev: { a: 3, b: null } } }), ['a1']);
});

test('the loss stage follows where the anchor was lost', () => {
  const relevant = ['a1'];
  assert.equal(lossStage({ relevant, outcome: 'answer', shown: ['nonconformity:a1'], candidates: ['a1'], judged: 30 }), null);
  assert.equal(lossStage({ relevant, outcome: 'answer', shown: ['x9'], candidates: ['x9', 'a1'], judged: 30 }), 'other_shown');
  assert.equal(lossStage({ relevant, outcome: 'no_result', shown: [], candidates: ['x1', 'a1'], judged: 30 }), 'judge_rejected');
  // The anchor ranked below the judged depth counts as outside the pool.
  assert.equal(lossStage({ relevant, outcome: 'no_result', shown: [], candidates: ['x1', 'a1'], judged: 1 }), 'not_in_pool');
  assert.equal(lossStage({ relevant, outcome: 'no_result', shown: [], candidates: [], judged: 30 }), 'not_in_pool');
  assert.equal(lossStage({ relevant, outcome: 'clarification', shown: [], candidates: [], judged: 30 }), 'status');
  assert.equal(lossStage({ relevant, outcome: 'out_of_scope', shown: [], candidates: [], judged: 30 }), 'status');
  assert.equal(lossStage({ relevant, outcome: 'unavailable', shown: [], candidates: [], judged: 30 }), 'status');
  assert.ok(LOSS_STAGES.includes('judge_rejected'));
});

test('live scoring sends candidate query maps to lexical ranking and loads active queries for the baseline', async () => {
  const catalog = loadNonconformityCatalog();
  const evaluate = async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map((key) => [key,
    key.startsWith('candidate_') || key === 'content' ? { type: 'noul', noul: 0.95 }
      : { type: 'choice', choice: key === 'scope' ? 'nonconformity' : key === 'sort' ? 'relevance' : key === 'limit' ? 'unspecified' : 'none' },
  ])) });
  const query = '学習専用語';
  const learned = [{ schema: LEARNED_SCHEMA, recordId: 'nonconformity:rec-gamma', query, state: 'candidate', source: 'synthetic', from: 'rec-gamma', night: '2026-10-03', at: '2026-10-03T15:00:00Z' }];
  const snapshot = structuredClone(learned);
  assert.deepEqual(learnedQueriesById(learned, { states: null }), new Map([['rec-gamma', [query]]]));
  const row = { a: 'rec-gamma', question: query };
  const options = { records, catalog, evaluate, env: { HERMES_FLYWHEEL_LEARNED_ENABLED: 'false' } };
  const baseline = await (await createLiveScorer(options))(row);
  assert.notEqual(baseline.candidates[0], 'rec-gamma');
  const candidate = await (await createLiveScorer({ ...options, learned }))(row);
  assert.equal(candidate.candidates.length, 4);
  assert.equal(candidate.candidates[0], 'rec-gamma');
  assert.equal(candidate.outcome, 'answer');
  assert.equal(candidate.reason, null);
  assert.equal(candidate.plan.semanticQuery, query);
  assert.equal(candidate.plan.limit, 5);
  assert.ok(Array.isArray(candidate.plan.filters));
  assert.deepEqual(learned, snapshot);
  const empty = await (await createLiveScorer({ ...options, learned: [] }))(row);
  assert.deepEqual(empty.candidates, baseline.candidates);
  assert.deepEqual(empty.shown, baseline.shown);
  const file = learnedPath(await mkdtemp(path.join(tmpdir(), 'live-learned-')));
  await writeLearned(file, [{ ...learned[0], state: 'active' }, { ...learned[0], recordId: 'rec-beta' }]);
  const active = await (await createLiveScorer({ ...options, env: { HERMES_FLYWHEEL_LEARNED_PATH: file } }))(row);
  assert.deepEqual(active.candidates, candidate.candidates);
});

test('live scoring returns the compact recent plan for a filter-only answer', async () => {
  const catalog = loadNonconformityCatalog();
  const evaluate = async ({ questions }) => ({ answers: Object.fromEntries(Object.keys(questions).map((key) => [key,
    key === 'content' ? { type: 'noul', noul: 0.05 }
      : { type: 'choice', choice: key === 'scope' ? 'nonconformity' : key === 'sort' ? 'recent' : key === 'limit' ? '2'
        : Object.entries(questions[key].criteria ?? {}).find(([, description]) => description === 'North Shop')?.[0] ?? 'none' },
  ])) });
  const corpus = records.map((record) => ({ ...record, originDepartmentName: 'North Shop' }));
  const score = await createLiveScorer({ records: corpus, catalog, evaluate, env: { HERMES_RETRIEVAL_DENSE_PROVIDER: 'off', HERMES_FLYWHEEL_LEARNED_ENABLED: 'false' } });
  const live = await score({ question: 'North Shopの不適合を２件' });
  assert.equal(live.outcome, 'answer');
  assert.equal(live.plan.semanticQuery, '');
  assert.deepEqual(live.plan.sort, { field: 'discoveredOn', direction: 'desc' });
  assert.equal(live.plan.limit, 2);
  assert.equal(live.shown.length, 2);
  assert.equal(live.vectorStatus, 'not_requested');
});

test('live scoring records the executor reason from the unavailable receipt', async () => {
  const evaluate = async ({ questions }) => {
    if (Object.keys(questions).some((key) => key.startsWith('candidate_'))) {
      throw Object.assign(new Error('private request and response bodies'), {
        hermesDiagnostic: { provider: 'typesafe-direct', failureCode: 'upstream_http', httpStatus: 403 },
      });
    }
    return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key,
      key === 'content' ? { type: 'noul', noul: 0.95 }
        : { type: 'choice', choice: key === 'scope' ? 'nonconformity' : key === 'sort' ? 'relevance' : key === 'limit' ? 'unspecified' : 'none' },
    ])) };
  };
  const score = await createLiveScorer({ records, catalog: loadNonconformityCatalog(), evaluate,
    env: { HERMES_RETRIEVAL_DENSE_PROVIDER: 'off', HERMES_FLYWHEEL_LEARNED_ENABLED: 'false' } });
  const live = await score({ a: 'rec-alpha', question: 'surface scratch' });
  assert.equal(live.outcome, 'unavailable');
  assert.equal(live.reason, 'relevance judgment failed: upstream_http 403');
  assert.equal(live.loss, 'status');
});

test('live scoring sanitizes and truncates thrown errors, retaining their diagnostic', async () => {
  const error = Object.assign(new Error(`Bearer private-key\n${'x'.repeat(250)}`), {
    hermesDiagnostic: { provider: 'typesafe-direct', failureCode: 'upstream_http', httpStatus: 429 },
  });
  const score = await createLiveScorer({ records, catalog: loadNonconformityCatalog(), evaluate: async () => { throw error; },
    env: { HERMES_RETRIEVAL_DENSE_PROVIDER: 'off', HERMES_FLYWHEEL_LEARNED_ENABLED: 'false' } });
  const live = await score({ a: 'rec-alpha', question: 'surface scratch' });
  assert.equal(live.outcome, 'failed');
  assert.equal(live.reason, `${('[redacted] ' + 'x'.repeat(250)).slice(0, 200)} (upstream_http 429)`);
  assert.equal(live.loss, 'failed');
  assert.equal(live.reason.includes('private-key'), false);
  assert.equal(live.reason.includes('\n'), false);
});
