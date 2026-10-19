import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEVANCE_POOL_DEFAULT, RELEVANCE_POOL_MAX, execute, relevancePoolLimit } from './executor.mjs';
import { records } from './fixtures/synthetic-records.mjs';
import { QUERY_PLAN_SCHEMA } from './query-plan.mjs';
import { RELEVANCE_ACCEPT_AT, RELEVANCE_CANDIDATE_LIMIT, candidateBody, createRelevanceJudge } from './relevance-jev.mjs';

const display = ['condition', 'remarks', 'correctiveContent', 'disposition'];
const body = display;

function diagnosticError(failureCode, httpStatus) {
  return Object.assign(new Error('API key, request body, response body must stay private'), {
    hermesDiagnostic: { provider: 'typesafe-direct', failureCode, ...(httpStatus ? { httpStatus } : {}) },
  });
}

const judgeInput = { semanticQuery: 'scratch', candidates: [{ id: 'a', record: { condition: 'scratch' } }], bodyFields: ['condition'] };

test('transient judge failures retry once after 2000 ms, including 429 then success', async (t) => {
  for (const [code, status] of [['upstream_http', 429], ['upstream_http', 500], ['upstream_http', 502], ['upstream_http', 503], ['upstream_http', 504], ['timeout'], ['connection_failed']]) {
    await t.test(`${code} ${status ?? ''}`, async () => {
      const calls = [];
      const delays = [];
      const judge = createRelevanceJudge({
        sleep: async (ms) => { delays.push(ms); },
        evaluate: async (input) => {
          calls.push(input);
          assert.equal(input.maxRetries, 0);
          if (calls.length === 1) throw diagnosticError(code, status);
          return { answers: { candidate_0: { type: 'noul', noul: 0.9 } } };
        },
      });
      const result = await judge.judge(judgeInput);
      assert.equal(calls.length, 2);
      assert.deepEqual(calls[0], calls[1]);
      assert.deepEqual(delays, [2000]);
      assert.equal(result.attempts, 2);
      assert.deepEqual(result.ranked, [{ id: 'a', probability: 0.9 }]);
      assert.ok(result.relevanceMs >= 0);
    });
  }
});

test('timeout then failure exposes attempts 2 and only the second diagnostic', async () => {
  let calls = 0;
  const second = diagnosticError('upstream_http', 503);
  const judge = createRelevanceJudge({
    sleep: async () => {},
    evaluate: async () => { throw ++calls === 1 ? diagnosticError('timeout') : second; },
  });
  await assert.rejects(judge.judge(judgeInput), (error) => {
    assert.equal(error.attempts, 2);
    assert.deepEqual(error.hermesDiagnostic, second.hermesDiagnostic);
    assert.equal(error.message, 'relevance judgment failed: upstream_http 503');
    assert.ok(error.relevanceMs >= 0);
    return true;
  });
  assert.equal(calls, 2);
});

test('permanent diagnostics and unlisted HTTP statuses never retry', async (t) => {
  for (const [code, status] of [['invalid_answers'], ['invalid_json'], ['missing_credentials'], ['transport_unavailable'], ['upstream_http', 400], ['upstream_http', 401], ['upstream_http', 408], ['upstream_http', 501], ['upstream_http']]) {
    await t.test(`${code} ${status ?? ''}`, async () => {
      let calls = 0;
      const judge = createRelevanceJudge({
        sleep: async () => assert.fail('permanent failures must not wait'),
        evaluate: async () => { calls += 1; throw diagnosticError(code, status); },
      });
      await assert.rejects(judge.judge(judgeInput), (error) => {
        assert.equal(error.attempts, 1);
        assert.equal(error.message, `relevance judgment failed: ${code}${status ? ` ${status}` : ''}`);
        return true;
      });
      assert.equal(calls, 1);
    });
  }
});

test('a parallel judge retries only the failed batch', async () => {
  const calls = [0, 0];
  const candidates = Array.from({ length: 30 }, (_, index) => ({ id: `r${index}`, record: { condition: index < 15 ? 'first' : 'second' } }));
  const judge = createRelevanceJudge({
    sleep: async () => {},
    evaluate: async ({ questions }) => {
      const batch = questions.candidate_0.instructions.endsWith('first') ? 0 : 1;
      calls[batch] += 1;
      if (batch === 0 && calls[batch] === 1) throw diagnosticError('upstream_http', 429);
      return { answers: Object.fromEntries(Object.keys(questions).map((key) => [key, { type: 'noul', noul: 0.9 }])) };
    },
  });
  const result = await judge.judge({ ...judgeInput, candidates, poolLimit: 30 });
  assert.deepEqual(calls, [2, 1]);
  assert.equal(result.attempts, 2);
  assert.equal(result.ranked.length, 30);
});

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
    assert.match(input.questions[keys[0]].criteria.true, /明示的に記述している/);
    assert.match(input.questions[keys[0]].criteria.true, /組織・日付・件数は判断に使わない/);
    assert.match(input.questions[keys[0]].criteria.false, /別の現象/);
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
  assert.equal(executed.reason, 'relevance judgment failed: relevance down');
  assert.deepEqual(executed.results, []);
});

test('a pool wider than one call is judged in parallel calls of the same size', async () => {
  const candidates = Array.from({ length: 32 }, (_, index) => ({ id: `r${index}`, record: { condition: index === 20 ? 'surface scratch' : 'other' } }));
  const calls = [];
  const judge = createRelevanceJudge({
    evaluate: async (input) => {
      const keys = Object.keys(input.questions);
      calls.push(keys.length);
      return {
        answers: Object.fromEntries(keys.map((key) => [key, {
          type: 'noul',
          noul: input.questions[key].instructions.includes('surface scratch\n\n記録本文:\nsurface scratch') ? 0.9 : 0.1,
        }])),
      };
    },
  });
  // Without a pool limit the judge reads one call; candidates past it are not judged.
  const narrow = await judge.judge({ semanticQuery: 'surface scratch', candidates, bodyFields: ['condition'] });
  assert.deepEqual(calls, [RELEVANCE_CANDIDATE_LIMIT]);
  assert.deepEqual(narrow.ranked, []);
  calls.length = 0;
  const wide = await judge.judge({ semanticQuery: 'surface scratch', candidates, bodyFields: ['condition'], poolLimit: 30 });
  assert.deepEqual(calls, [RELEVANCE_CANDIDATE_LIMIT, RELEVANCE_CANDIDATE_LIMIT]);
  assert.deepEqual(wide.ranked.map((item) => item.id), ['r20']);

  assert.equal(relevancePoolLimit({}, {}), RELEVANCE_POOL_DEFAULT);
  assert.equal(RELEVANCE_POOL_DEFAULT, 30);
  assert.equal(relevancePoolLimit({}, { HERMES_RETRIEVAL_RELEVANCE_POOL: '15' }), RELEVANCE_CANDIDATE_LIMIT);
  assert.equal(relevancePoolLimit({}, { HERMES_RETRIEVAL_RELEVANCE_POOL: '30' }), 30);
  assert.equal(relevancePoolLimit({ relevancePool: 45 }, { HERMES_RETRIEVAL_RELEVANCE_POOL: '30' }), 45);
  assert.equal(relevancePoolLimit({}, { HERMES_RETRIEVAL_RELEVANCE_POOL: '5' }), RELEVANCE_CANDIDATE_LIMIT);
  assert.equal(relevancePoolLimit({}, { HERMES_RETRIEVAL_RELEVANCE_POOL: '999' }), RELEVANCE_POOL_MAX);
  assert.equal(relevancePoolLimit({}, { HERMES_RETRIEVAL_RELEVANCE_POOL: 'abc' }), RELEVANCE_POOL_DEFAULT);
});
