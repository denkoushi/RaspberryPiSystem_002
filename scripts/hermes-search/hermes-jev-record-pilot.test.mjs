import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fixture from './hermes-jev-record-pilot-fixture.json' with { type: 'json' };
import expandedFixture from './hermes-jev-record-pilot-expanded-fixture.mjs';
import { AXES, createStore, createTypesafeDirectEvaluate, DIRECT_ENDPOINT, DIRECT_MODEL, runPilot, searchStored, validateFixture } from './hermes-jev-record-pilot.mjs';

const correctedQueryTreatments = {
  'query-turning-oversize': 'unknown',
  'query-milling-damage': 'unknown',
};

function fakeEvaluate({ state }) {
  const text = state.request;
  const answer = (choice) => ({ type: 'choice', choice });
  const classification = text.includes('旋盤')
    ? { process: 'turning', phenomenon: 'oversize', treatment: text.includes('再加工') ? 'rework' : text.includes('選別') || text.includes('隔離') ? 'segregate' : 'unknown', cause: 'unknown' }
    : text.includes('フライス')
      ? { process: 'milling', phenomenon: 'surface_damage', treatment: text.includes('再加工') ? 'rework' : text.includes('選別') || text.includes('隔離') ? 'segregate' : 'unknown', cause: 'unknown' }
      : { process: 'inspection', phenomenon: 'missing_marking', treatment: text.includes('隔離') ? 'segregate' : 'design_consultation', cause: text.includes('工具摩耗') ? 'tool_wear' : 'unknown' };
  return { answers: Object.fromEntries(AXES.map((axis) => [axis, answer(classification[axis])])) };
}

test('fixed fixture and saved classification search keep raw text separate', async () => {
  validateFixture(fixture);
  const result = await runPilot({ evaluateImplementation: fakeEvaluate });
  assert.equal(result.classificationCalls, 3);
  assert.equal(result.queryClassificationCalls, 2);
  assert.equal(result.searchRecordJevCalls, 0);
  assert.deepEqual(result.store.classifications, fixture.records.map(({ id, expectedClassification }) => ({ id, ...expectedClassification })));
  for (const query of fixture.queries) {
    const observed = result.searches.find((item) => item.id === query.id);
    assert.deepEqual(observed.classification, { ...query.expectedClassification, treatment: correctedQueryTreatments[query.id] });
    assert.deepEqual(observed.records.map((record) => record.id), query.expectedRecordIds);
    for (const record of observed.records) assert.equal(record.rawText, fixture.records.find((item) => item.id === record.id).rawText);
  }
  assert.ok(!JSON.stringify(result.store.classifications).includes('外径が規格上限を0.12 mm超過'));
});

test('search uses saved classifications and does not call an evaluator', () => {
  const records = fixture.records.map(({ id, rawText }) => ({ id, rawText }));
  const store = {
    records,
    classifications: fixture.records.map(({ id, expectedClassification }) => ({ id, ...expectedClassification })),
    _recordById: new Map(records.map((record) => [record.id, record])),
  };
  assert.deepEqual(searchStored(store, fixture.queries[0].expectedClassification).map((record) => record.id), ['fixture-nc-001']);
});

test('direct TypeSafe adapter uses the official request boundary without Vercel credentials', async () => {
  let request;
  const evaluate = createTypesafeDirectEvaluate({
    apiKey: 'fixture-only-key',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({
        model: DIRECT_MODEL,
        answers: { process: { type: 'choice', choice: 'turning' } },
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const input = {
    model: 'typesafe-ai/jev',
    state: { request: '架空質問', relatedHistory: [], confirmationPending: null },
    questions: { process: { type: 'choice', instructions: '工程', criteria: { turning: '旋盤', unknown: '不明' } } },
    maxRetries: 0,
  };
  const result = await evaluate(input);
  assert.equal(request.url, DIRECT_ENDPOINT);
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers.Authorization, 'Bearer fixture-only-key');
  assert.equal(request.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(request.init.body), {
    model: DIRECT_MODEL,
    state: input.state,
    questions: input.questions,
  });
  assert.equal(result.model, DIRECT_MODEL);
  assert.equal(result.answers.process.choice, 'turning');
});

test('direct TypeSafe failures expose only a fixed category and upstream status', async () => {
  const input = { model: 'typesafe-ai/jev', state: { request: '架空質問' }, questions: {} };
  const cases = [
    {
      fetchImpl: async () => new Response('private upstream body', { status: 503 }),
      expected: { provider: 'typesafe-direct', failureCode: 'upstream_http', httpStatus: 503 },
    },
    {
      fetchImpl: async () => { const error = new Error('private transport detail'); error.name = 'AbortError'; throw error; },
      expected: { provider: 'typesafe-direct', failureCode: 'timeout' },
    },
  ];
  for (const { fetchImpl, expected } of cases) {
    const evaluate = createTypesafeDirectEvaluate({ apiKey: 'fixture-only-key', fetchImpl });
    await assert.rejects(evaluate(input), (error) => {
      assert.deepEqual(error.hermesDiagnostic, expected);
      assert.ok(!error.message.includes('private'));
      return true;
    });
  }
});

test('expanded fixed fixture distinguishes same process and phenomenon by explicit treatment', async () => {
  validateFixture(expandedFixture);
  const result = await runPilot({
    fixturePath: fileURLToPath(new URL('./hermes-jev-record-pilot-expanded-fixture.mjs', import.meta.url)),
    evaluateImplementation: fakeEvaluate,
  });
  assert.equal(result.recordCount, 6);
  assert.equal(result.classificationCalls, 6);
  assert.equal(result.queryClassificationCalls, 6);
  assert.equal(result.searchRecordJevCalls, 0);
  assert.deepEqual(result.store.classifications, expandedFixture.records.map(({ id, expectedClassification }) => ({ id, ...expectedClassification })));
  for (const query of expandedFixture.queries) {
    const observed = result.searches.find((item) => item.id === query.id);
    assert.deepEqual(observed.classification, query.expectedClassification);
    assert.deepEqual(observed.records.map((record) => record.id), query.expectedRecordIds);
    for (const record of observed.records) assert.equal(record.rawText, expandedFixture.records.find((item) => item.id === record.id).rawText);
  }
});

test('expanded pilot reuses unchanged persisted classifications', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hermes-jev-record-pilot-'));
  const storePath = path.join(directory, 'store.json');
  let firstCalls = 0;
  const first = await runPilot({
    fixturePath: fileURLToPath(new URL('./hermes-jev-record-pilot-expanded-fixture.mjs', import.meta.url)),
    storePath,
    evaluateImplementation: (input) => { firstCalls += 1; return fakeEvaluate(input); },
  });
  let secondCalls = 0;
  const second = await runPilot({
    fixturePath: fileURLToPath(new URL('./hermes-jev-record-pilot-expanded-fixture.mjs', import.meta.url)),
    storePath,
    evaluateImplementation: (input) => { secondCalls += 1; return fakeEvaluate(input); },
  });
  assert.equal(first.classificationCalls, 6);
  assert.equal(firstCalls, 12);
  assert.equal(second.classificationCalls, 0);
  assert.equal(second.reusedRecordCount, 6);
  assert.equal(second.newOrChangedRecordCount, 0);
  assert.equal(second.queryClassificationCalls, 6);
  assert.equal(secondCalls, 6);
  await rm(directory, { recursive: true, force: true });
});
