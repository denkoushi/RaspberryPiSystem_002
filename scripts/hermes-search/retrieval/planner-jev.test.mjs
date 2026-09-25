import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNonconformityCatalog } from './catalog.mjs';
import { createPlanner } from './planner-jev.mjs';
import { buildValueIndex } from './value-index.mjs';

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
    // The current utterance alone is judged; the previous plan is context only.
    assert.equal(input.state.request, 'South Shopも見る');
    assert.equal(input.state.relatedHistory.length, 1);
    assert.match(input.state.relatedHistory[0].content, /Lathe-1/u);
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
  // The follow-up adds only an organization, so the previous content condition stays.
  assert.equal(plan.semanticQuery, 'paint');
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
  assert.equal(plan.semanticQuery, 'North Shopのsurface scratchを最新3件見せて');
  assert.equal(plan.diagnostics.contentDecision.final, true);
  assert.deepEqual(plan.diagnostics.contentDecision.residualTokens, []);
  assert.equal(plan.limit, 3);
  assert.deepEqual(plan.sort, { field: 'discoveredOn', direction: 'desc' });
});

test('a false content noul skips relevance and does not search residual tokens', async () => {
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
  assert.equal(plan.semanticQuery, '');
  assert.deepEqual(plan.diagnostics.contentDecision, {
    jev: false,
    residualTokens: [],
    final: false,
  });
});

test('a false content noul without a hard filter keeps the whole question for relevance', async () => {
  const evaluate = async () => ({
    answers: {
      sort: { type: 'choice', choice: 'recent' },
      limit: { type: 'choice', choice: '3' },
      content: { type: 'noul', noul: 0.1 },
    },
  });
  const question = 'qxrareを最新3件見せて';
  const { plan } = await createPlanner({ evaluate }).plan({
    question,
    previousPlan: null,
    catalog,
    candidates: [],
  });
  assert.deepEqual(plan.filters, []);
  assert.equal(plan.semanticQuery, question);
  assert.equal(plan.diagnostics.contentDecision.jev, false);
});

test('value-index planner keeps one call, selects close values, and rejects non-record questions', async () => {
  const records = [
    { id: 'a', originDepartmentName: 'Alpha Plant Manufacturing Machining' },
    { id: 'b', originDepartmentName: 'Alpha Plant Manufacturing Assembly' },
    { id: 'c', originDepartmentName: 'Beta Plant Support' },
  ];
  const valueIndex = buildValueIndex(records, catalog);
  let calls = 0;
  const evaluate = async (input) => {
    calls += 1;
    assert.match(input.questions.scope.criteria.out_of_scope, /不適合として記録された事象/);
    assert.match(input.questions.scope.instructions, /不適合として記録された事象/);
    assert.equal(input.questions.limit.criteria.unspecified, '件数の指定はない');
    const field = Object.entries(input.questions).find(([key]) => key.startsWith('field_'));
    assert.equal(field[1].criteria.none, 'この語は絞り込み条件にしない');
    const ids = Object.entries(field[1].criteria).filter(([, description]) => description.includes('Machining') || description.includes('Assembly'));
    return {
      answers: {
        scope: { type: 'choice', choice: 'nonconformity' },
        [field[0]]: {
          type: 'choice',
          probabilities: Object.fromEntries([
            ...ids.map(([id]) => [id, 0.82]),
            ['none', 0.05],
          ]),
        },
        sort: { type: 'choice', choice: 'recent' },
        limit: { type: 'choice', choice: 'unspecified' },
        content: { type: 'noul', noul: 0.1 },
      },
    };
  };
  const selected = await createPlanner({ evaluate }).plan({
    question: 'Alpha Plant Machining',
    catalog,
    valueIndex,
  });
  assert.equal(calls, 1);
  assert.equal(selected.plan.diagnostics.scope, 'records');
  assert.equal(selected.plan.diagnostics.limitExplicit, false);
  assert.equal(selected.plan.filters[0].op, 'in');
  assert.equal(selected.plan.filters[0].values.length, 2);
  const rejected = await createPlanner({ evaluate: async () => ({
    answers: {
      scope: { type: 'choice', choice: 'out_of_scope' },
      sort: { type: 'choice', choice: 'recent' },
      limit: { type: 'choice', choice: 'unspecified' },
      content: { type: 'noul', noul: 0.1 },
    },
  }) }).plan({ question: 'what is the weather', catalog, valueIndex });
  assert.equal(rejected.plan.diagnostics.scope, 'out_of_scope');
  assert.deepEqual(rejected.plan.sources, []);
});

function departmentAnswers(probabilities, content = 0.1) {
  return async (input) => {
    const field = Object.entries(input.questions).find(([key]) => key.startsWith('field_'));
    const valueId = Object.entries(field[1].criteria).find(([, description]) => description.includes('機械課'))[0];
    return {
      answers: {
        scope: { type: 'choice', choice: 'nonconformity' },
        [field[0]]: { type: 'choice', probabilities: { [valueId]: probabilities.value, none: probabilities.none } },
        sort: { type: 'choice', choice: 'recent' },
        limit: { type: 'choice', choice: 'unspecified' },
        content: { type: 'noul', noul: content },
      },
    };
  };
}

test('selected department covers particle and cause phrasing without a content query', async () => {
  const records = [{ id: 'a', originDepartmentName: '北海工場製造部機械課' }];
  const valueIndex = buildValueIndex(records, catalog);
  const covered = await createPlanner({ evaluate: departmentAnswers({ value: 1, none: 0 }) }).plan({
    question: '北海の機械課が原因の記録',
    catalog,
    valueIndex,
  });
  assert.equal(covered.plan.semanticQuery, '');
  assert.equal(covered.plan.filters[0].values[0], '北海工場製造部機械課');
  const asked = await createPlanner({ evaluate: departmentAnswers({ value: 1, none: 0 }, 0.9) }).plan({
    question: '北海の機械課のburrtoken',
    catalog,
    valueIndex,
  });
  assert.equal(asked.plan.semanticQuery, '北海の機械課のburrtoken');
});

test('an unambiguous period becomes one date filter inside the same evaluate call', async () => {
  let calls = 0;
  const evaluate = async (input) => {
    calls += 1;
    assert.equal(input.questions.period, undefined);
    return {
      answers: {
        sort: { type: 'choice', choice: 'recent' },
        limit: { type: 'choice', choice: '5' },
        content: { type: 'noul', noul: true },
      },
    };
  };
  const { plan } = await createPlanner({ evaluate }).plan({
    question: '2024年のqxrare',
    catalog,
    candidates: [],
    now: '2026-09-24',
  });
  assert.equal(calls, 1);
  assert.deepEqual(plan.filters, [{
    source: 'nonconformity',
    field: 'discoveredOn',
    op: 'between',
    values: ['2024-01-01', '2024-12-31'],
  }]);
  assert.equal(plan.sort, 'relevance');
  assert.equal(plan.semanticQuery, '2024年のqxrare');
});

test('an ambiguous period is chosen inside the existing evaluate call', async () => {
  let calls = 0;
  const evaluate = async (input) => {
    calls += 1;
    assert.deepEqual(Object.keys(input.questions.period.criteria), ['p0', 'p1', 'none']);
    return {
      answers: {
        period: { type: 'choice', choice: 'p1' },
        sort: { type: 'choice', choice: 'recent' },
        limit: { type: 'choice', choice: '5' },
        content: { type: 'noul', noul: true },
      },
    };
  };
  const { plan } = await createPlanner({ evaluate }).plan({
    question: '12月のqxrare',
    catalog,
    candidates: [],
    now: '2026-09-24',
  });
  assert.equal(calls, 1);
  assert.equal(plan.filters[0].op, 'between');
  assert.deepEqual(plan.filters[0].values, ['2025-12-01', '2025-12-31']);
});

test('a close out-of-scope score stays in scope for a work question', async () => {
  const kept = await createPlanner({ evaluate: async (input) => {
    assert.match(input.questions.scope.instructions, /図面、設計、工程/);
    return {
      answers: {
        scope: { type: 'choice', probabilities: { nonconformity: 0.45, out_of_scope: 0.55 } },
        sort: { type: 'choice', choice: 'relevance' },
        limit: { type: 'choice', choice: 'unspecified' },
        content: { type: 'noul', noul: true },
      },
    };
  } }).plan({
    question: '図面の差し替えを忘れたqxdraw',
    catalog,
    valueIndex: buildValueIndex([{ id: 'a', originDepartmentName: 'North Shop' }], catalog),
  });
  assert.equal(kept.plan.diagnostics.scope, 'records');
  assert.equal(kept.plan.diagnostics.contentDecision.jev, true);
});

test('a content question without recency stays relevance even if JEV picks recent', async () => {
  const evaluate = async () => ({
    answers: {
      sort: { type: 'choice', choice: 'recent' },
      limit: { type: 'choice', choice: '5' },
      content: { type: 'noul', noul: true },
    },
  });
  const { plan } = await createPlanner({ evaluate }).plan({
    question: 'qxrareを見せて',
    catalog,
    candidates: [],
  });
  assert.equal(plan.sort, 'relevance');
});

test('a low-confidence department value asks for clarification instead of a content search', async () => {
  const records = [{ id: 'a', originDepartmentName: '北海工場製造部機械課' }];
  const valueIndex = buildValueIndex(records, catalog);
  const { plan } = await createPlanner({ evaluate: departmentAnswers({ value: 0.26, none: 0.29 }) }).plan({
    question: '北海の機戒課',
    catalog,
    valueIndex,
  });
  assert.equal(plan.semanticQuery, '');
  assert.equal(plan.filters.length, 0);
  assert.equal(plan.unresolved.length, 1);
  assert.deepEqual(plan.unresolved[0].candidates, ['北海工場製造部機械課']);
});


test('a refine turn without its own content keeps the previous content condition', async () => {
  const evaluate = async () => ({
    answers: {
      term_0: { type: 'choice', choice: 'v0' },
      turn: { type: 'choice', choice: 'refine' },
      sort: { type: 'choice', choice: 'relevance' },
      limit: { type: 'choice', choice: '5' },
      content: { type: 'noul', noul: 0.1 },
    },
  });
  const previousPlan = { sources: ['nonconformity'], filters: [], semanticQuery: 'rust on the table', sort: 'relevance', limit: 5 };
  const candidates = [{ term: 'South Shop', source: 'nonconformity', field: 'originDepartmentName', values: ['South Shop'] }];
  const refined = await createPlanner({ evaluate }).plan({ question: 'South Shopだけ', previousPlan, catalog, candidates });
  assert.equal(refined.plan.semanticQuery, 'rust on the table');
  assert.equal(refined.plan.filters.some((filter) => filter.values[0] === 'South Shop'), true);
  const fresh = await createPlanner({ evaluate }).plan({ question: 'South Shopだけ', previousPlan: null, catalog, candidates });
  assert.equal(fresh.plan.semanticQuery, '');
});
