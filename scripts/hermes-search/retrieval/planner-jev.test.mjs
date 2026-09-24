import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNonconformityCatalog } from './catalog.mjs';
import { createPlanner } from './planner-jev.mjs';

const catalog = loadNonconformityCatalog();
const fixedDescriptions = new Set([
  'この語は絞り込み条件にしない',
  '直前の計画は使わず、今回の発話だけで検索する',
  '直前の計画を土台に、今回選んだ条件で更新する',
  '日付が新しい順',
  '意味の近さ順',
  '1件', '2件', '3件', '5件', '10件', '20件',
]);

function assertChoicesFromCandidates(questions, candidateValues) {
  const allowed = new Set([...candidateValues, ...fixedDescriptions]);
  assert.equal(questions.content?.type, 'noul');
  assert.deepEqual(Object.keys(questions.content.criteria).sort(), ['false', 'true']);
  for (const question of Object.values(questions)) {
    if (question.type === 'noul') continue;
    assert.equal(question.type, 'choice');
    for (const description of Object.values(question.criteria)) {
      assert.equal(allowed.has(description), true, description);
      assert.notEqual(description, 'Invented Only By Model');
    }
  }
}

test('planner calls evaluate once and builds filters only from candidate choices', async () => {
  let calls = 0;
  const evaluate = async (input) => {
    calls += 1;
    assert.equal(input.model, 'typesafe-ai/jev');
    assert.equal(input.maxRetries, 0);
    assert.equal(Object.keys(input.questions).includes('term_0'), true);
    assert.equal(input.questions.term_0.criteria.none, 'この語は絞り込み条件にしない');
    assertChoicesFromCandidates(input.questions, ['North Shop', 'South Shop']);
    assert.equal(input.questions.turn, undefined);
    return {
      answers: {
        term_0: { type: 'choice', choice: 'v0' },
        sort: { type: 'choice', choice: 'recent' },
        limit: { type: 'choice', choice: '2' },
        content: { type: 'noul', noul: false },
      },
    };
  };
  const { plan, timings } = await createPlanner({ evaluate }).plan({
    question: 'North Shopの最近の記録を2件見せて',
    previousPlan: null,
    catalog,
    candidates: [{
      term: 'North Shop',
      source: 'nonconformity',
      field: 'originDepartmentName',
      values: ['North Shop', 'South Shop'],
    }],
  });
  assert.equal(calls, 1);
  assert.equal(typeof timings.planMs, 'number');
  assert.deepEqual(plan.filters, [{
    source: 'nonconformity',
    field: 'originDepartmentName',
    op: 'eq',
    values: ['North Shop'],
  }]);
  assert.equal(plan.semanticQuery, '');
  assert.deepEqual(plan.diagnostics.contentDecision, { jev: false, residualTokens: [], final: false });
  assert.deepEqual(plan.sort, { field: 'discoveredOn', direction: 'desc' });
  assert.equal(plan.limit, 2);
  assert.deepEqual(plan.unresolved, []);
});

test('planner can refine a previous plan without a second evaluate call', async () => {
  let calls = 0;
  const evaluate = async (input) => {
    calls += 1;
    assert.deepEqual(Object.keys(input.questions.turn.criteria).sort(), ['new_search', 'refine']);
    assertChoicesFromCandidates(input.questions, ['South Shop']);
    return {
      answers: {
        term_0: { type: 'choice', choice: 'v0' },
        turn: { type: 'choice', choice: 'refine' },
        sort: { type: 'choice', choice: 'relevance' },
        limit: { type: 'choice', choice: '5' },
        content: { type: 'noul', noul: 0.1 },
      },
    };
  };
  const previousPlan = {
    sources: ['nonconformity'],
    filters: [{ source: 'nonconformity', field: 'machineName', op: 'eq', values: ['Lathe-1'] }],
    semanticQuery: 'paint',
    sort: 'relevance',
    limit: 5,
  };
  const { plan } = await createPlanner({ evaluate }).plan({
    question: 'South Shopも見る',
    previousPlan,
    catalog,
    candidates: [{
      term: 'South Shop',
      source: 'nonconformity',
      field: 'originDepartmentName',
      values: ['South Shop'],
    }],
  });
  assert.equal(calls, 1);
  assert.equal(plan.filters.some((filter) => filter.field === 'machineName' && filter.values[0] === 'Lathe-1'), true);
  assert.equal(plan.filters.some((filter) => filter.field === 'originDepartmentName' && filter.values[0] === 'South Shop'), true);
  assert.equal(plan.sort, 'relevance');
});

test('an answer outside the candidate ids stays unresolved', async () => {
  const evaluate = async () => ({
    answers: {
      term_0: { type: 'choice', choice: 'invented-shop' },
      sort: { type: 'choice', choice: 'relevance' },
      limit: { type: 'choice', choice: '1' },
      content: { type: 'noul', noul: true },
    },
  });
  const { plan } = await createPlanner({ evaluate }).plan({
    question: 'North Shop',
    previousPlan: null,
    catalog,
    candidates: [{
      term: 'North Shop',
      source: 'nonconformity',
      field: 'originDepartmentName',
      values: ['North Shop'],
    }],
  });
  assert.equal(plan.filters.length, 0);
  assert.equal(plan.unresolved[0].term, 'North Shop');
  assert.deepEqual(plan.unresolved[0].candidates, ['North Shop']);
});

test('a content noul keeps one call and strips structural words from semanticQuery', async () => {
  let calls = 0;
  const evaluate = async (input) => {
    calls += 1;
    assert.equal(input.questions.content.type, 'noul');
    assert.equal(Object.keys(input.questions).filter((key) => input.questions[key].type === 'noul').length, 1);
    return {
      answers: {
        term_0: { type: 'choice', choice: 'v0' },
        sort: { type: 'choice', choice: 'recent' },
        limit: { type: 'choice', choice: '3' },
        content: { type: 'noul', noul: 0.91 },
      },
    };
  };
  const { plan } = await createPlanner({ evaluate }).plan({
    question: 'North Shopのsurface scratchを最新3件見せて',
    previousPlan: null,
    catalog,
    candidates: [{
      term: 'North Shop',
      source: 'nonconformity',
      field: 'originDepartmentName',
      values: ['North Shop'],
    }],
  });
  assert.equal(calls, 1);
  assert.equal(plan.semanticQuery, 'surface scratch');
  assert.equal(plan.diagnostics.contentDecision.final, true);
  assert.deepEqual(plan.diagnostics.contentDecision.residualTokens, ['surface', 'scratch']);
  assert.equal(plan.limit, 3);
  assert.deepEqual(plan.sort, { field: 'discoveredOn', direction: 'desc' });
});

test('a false content noul cannot drop a residual content token', async () => {
  const evaluate = async () => ({
    answers: {
      term_0: { type: 'choice', choice: 'v0' },
      sort: { type: 'choice', choice: 'recent' },
      limit: { type: 'choice', choice: '3' },
      content: { type: 'noul', noul: 0.1 },
    },
  });
  const { plan } = await createPlanner({ evaluate }).plan({
    question: 'North Shopのqxrareを最新3件見せて',
    previousPlan: null,
    catalog,
    candidates: [{
      term: 'North Shop',
      source: 'nonconformity',
      field: 'originDepartmentName',
      values: ['North Shop'],
    }],
  });
  assert.equal(plan.semanticQuery, 'qxrare');
  assert.deepEqual(plan.diagnostics.contentDecision, {
    jev: false,
    residualTokens: ['qxrare'],
    final: true,
  });
});
