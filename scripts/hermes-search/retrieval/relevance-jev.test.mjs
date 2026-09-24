import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from './executor.mjs';
import { records } from './fixtures/synthetic-records.mjs';
import { QUERY_PLAN_SCHEMA } from './query-plan.mjs';
import { RELEVANCE_ACCEPT_AT, RELEVANCE_CANDIDATE_LIMIT, candidateBody, createRelevanceJudge } from './relevance-jev.mjs';

const display = ['condition', 'remarks', 'correctiveContent', 'disposition'];
const body = display;

function plan(overrides = {}) {
  return {
    schema: QUERY_PLAN_SCHEMA,
    sources: ['nonconformity'],
    filters: [],
    semanticQuery: 'surface scratch',
    sort: 'relevance',
    limit: 5,
    display,
    unresolved: [],
    ...overrides,
  };
}

test('relevance judgment uses one call, drops false candidates, and caps the questions', async () => {
  assert.equal(RELEVANCE_ACCEPT_AT, 0.5);
  assert.equal(RELEVANCE_CANDIDATE_LIMIT, 15);
  const long = 'x'.repeat(500);
  assert.equal(candidateBody({ condition: long }, ['condition']).length, 300);
  let calls = 0;
  const evaluate = async (input) => {
    calls += 1;
    const keys = Object.keys(input.questions);
    assert.ok(keys.length >= 1);
    assert.ok(keys.length <= RELEVANCE_CANDIDATE_LIMIT);
    assert.ok(keys.every((key) => input.questions[key].type === 'noul'));
    assert.match(input.questions[keys[0]].criteria.true, /明示的に記述/);
    assert.match(input.questions[keys[0]].criteria.true, /部品や工程だけ/);
    const answers = {};
    for (const key of keys) {
      const text = input.questions[key].instructions;
      assert.match(text, /surface scratch/);
      const bodyText = text.split('記録本文:\n')[1] ?? '';
      const positive = bodyText.includes('surface scratch');
      answers[key] = { type: 'noul', noul: positive ? 0.8 : 0.2 };
    }
    return { answers };
  };
  const judge = createRelevanceJudge({ evaluate });
  const executed = await execute(plan({ limit: 3 }), {
    records,
    bodyFields: body,
    relevance: (input) => judge.judge(input),
  });
  assert.equal(calls, 1);
  assert.equal(executed.status, 'answer');
  assert.deepEqual(executed.results.map((result) => result.recordId), ['rec-alpha']);
  assert.equal(executed.insufficient, true);
  assert.equal(executed.returned, 1);
  assert.equal(typeof executed.timings.relevanceMs, 'number');
});

test('relevance judgment asks at most 15 candidates', async () => {
  const many = [];
  for (let index = 0; index < 16; index += 1) {
    many.push({
      id: `row-${index}`,
      condition: `qxtoken ${index}`,
      remarks: '',
      correctiveContent: '',
      disposition: '',
    });
  }
  let asked = 0;
  const judge = createRelevanceJudge({
    evaluate: async (input) => {
      asked = Object.keys(input.questions).length;
      const answers = {};
      for (const key of Object.keys(input.questions)) answers[key] = { type: 'noul', noul: 0.1 };
      return { answers };
    },
  });
  await judge.judge({
    semanticQuery: 'qxtoken',
    candidates: many.map((record) => ({ id: record.id, record })),
    bodyFields: body,
  });
  assert.equal(asked, RELEVANCE_CANDIDATE_LIMIT);
});

test('a failed relevance judgment returns unavailable instead of unjudged rows', async () => {
  const judge = createRelevanceJudge({
    evaluate: async () => {
      throw new Error('relevance down');
    },
  });
  const executed = await execute(plan({ limit: 2 }), {
    records,
    bodyFields: body,
    relevance: (input) => judge.judge(input),
  });
  assert.equal(executed.status, 'unavailable');
  assert.match(executed.reason, /relevance down/);
  assert.deepEqual(executed.results, []);
});
