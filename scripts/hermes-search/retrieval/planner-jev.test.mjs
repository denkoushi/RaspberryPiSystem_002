import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, loadNonconformityCatalog } from './catalog.mjs';
import { summarizeAnswers, createPlanner } from './planner-jev.mjs';
import { CAUSE_CATEGORIES } from './cause-categories.mjs';
import { buildValueIndex } from './value-index.mjs';

const catalog = loadNonconformityCatalog();

for (const [suffix, residualTokens] of [
  [' 最近 不適合', []],
  ['の先月の不適合', []],
  ['の錆の不適合', ['錆']],
]) {
  test(`resolved department with ${suffix} overrides content only when the residual is empty`, async () => {
    const value = '三島工場管理部生産管理課（製造）';
    const question = `${value.normalize('NFKC')}${suffix}`;
    const evaluate = async (input) => {
      const field = Object.entries(input.questions).find(([key]) => key.startsWith('field_'));
      const choice = Object.entries(field[1].criteria).find(([, description]) => description === value)[0];
      return { answers: {
        scope: { type: 'choice', choice: 'nonconformity' },
        [field[0]]: { type: 'choice', choice },
        content: { type: 'noul', noul: true },
        sort: { type: 'choice', choice: 'relevance' },
        limit: { type: 'choice', choice: '5' },
      } };
    };
    const { plan } = await createPlanner({ evaluate }).plan({
      question, catalog, now: '2026-10-10',
      valueIndex: buildValueIndex([{ id: 'a', originDepartmentName: value }], catalog),
    });
    assert.deepEqual(plan.diagnostics.contentDecision.residualTokens, residualTokens);
    assert.equal(plan.semanticQuery, residualTokens.length ? question : '');
    assert.equal(plan.diagnostics.contentDecision.jev, residualTokens.length > 0);
    assert.equal(plan.diagnostics.contentDecision.residualOverride === true, residualTokens.length === 0);
    assert.deepEqual(plan.sort, residualTokens.length ? 'relevance' : { field: 'discoveredOn', direction: 'desc' });
    assert.deepEqual(plan.filters[0], { source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: [value] });
    if (suffix.includes('先月')) {
      assert.deepEqual(plan.filters[1], { source: 'nonconformity', field: 'discoveredOn', op: 'between', values: ['2026-09-01', '2026-09-30'] });
    }
  });
}

for (const [question, residualTokens] of [
  ['機構設計2課(製造) 最近 不適合', []],
  ['機構設計2課 最近 不適合', []],
  ['機構設計2課(製造)の錆の不適合', ['錆']],
]) {
  test(`short department form ${question} keeps only tokens outside the selected value`, async () => {
    const value = '三島工場技術部機構設計２課（製造）';
    const siblings = ['三島工場技術部機構設計１課（製造）', '三島工場品質保証課（製造）'];
    const evaluate = async (input) => {
      const field = Object.entries(input.questions).find(([key]) => key.startsWith('field_'));
      const choice = Object.entries(field[1].criteria).find(([, description]) => description === value)[0];
      return { answers: {
        scope: { type: 'choice', choice: 'nonconformity' },
        [field[0]]: { type: 'choice', choice },
        content: { type: 'noul', noul: true },
        sort: { type: 'choice', choice: 'relevance' },
        limit: { type: 'choice', choice: '5' },
      } };
    };
    const { plan } = await createPlanner({ evaluate }).plan({
      question, catalog, now: '2026-10-14',
      valueIndex: buildValueIndex([value, ...siblings].map((name, index) => ({ id: `r${index}`, originDepartmentName: name })), catalog),
    });
    assert.deepEqual(plan.filters[0], { source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: [value] });
    assert.deepEqual(plan.diagnostics.contentDecision.residualTokens, residualTokens);
    assert.equal(plan.semanticQuery, residualTokens.length ? question : '');
    assert.deepEqual(plan.sort, residualTokens.length ? 'relevance' : { field: 'discoveredOn', direction: 'desc' });
  });
}

test('residual removal uses both a resolved value and its matched question term', async () => {
  const value = '三島工場管理部生産管理課（製造）';
  const term = '三島生管';
  for (const linked of [false, true]) {
    const evaluate = async () => ({ answers: {
      [linked ? 'field_0' : 'term_0']: { type: 'choice', choice: 'v0' },
      content: { type: 'noul', noul: true },
      sort: { type: 'choice', choice: 'relevance' },
      limit: { type: 'choice', choice: '5' },
    } });
    const group = { source: 'nonconformity', field: 'originDepartmentName', term, values: [value] };
    const { plan } = await createPlanner({ evaluate }).plan({
      question: `${term} ${value}の不適合`, catalog,
      ...(linked ? { choiceGroups: [group] } : { candidates: [group] }),
    });
    assert.equal(plan.semanticQuery, '');
    assert.equal(plan.diagnostics.contentDecision.residualOverride, true);
    assert.deepEqual(plan.diagnostics.contentDecision.residualTokens, []);
  }
});

test('an empty residual without an applied hard filter does not override content', async () => {
  const evaluate = async () => ({ answers: {
    content: { type: 'noul', noul: true },
    sort: { type: 'choice', choice: 'relevance' },
    limit: { type: 'choice', choice: '5' },
  } });
  const { plan } = await createPlanner({ evaluate }).plan({ question: '最近 不適合', catalog });
  assert.deepEqual(plan.filters, []);
  assert.deepEqual(plan.diagnostics.contentDecision.residualTokens, []);
  assert.equal(plan.diagnostics.contentDecision.jev, true);
  assert.equal(plan.diagnostics.contentDecision.residualOverride, undefined);
  assert.equal(plan.semanticQuery, '最近 不適合');
});

const fixedDescriptions = new Set([
  'この語は絞り込み条件にしない',
  '`request` だけで探す条件が完結している、または `previous_plan` の組織や範囲を外す・置き換える（例: 全部門で、〇〇課の最近の不適合N件、別の不具合の不適合）',
  '`request` が `previous_plan` の結果をさらに絞る・件数を変える・組織を追加する（例: そのうち〇〇の、〇〇に限定して、N件にして、〇〇も見る）',
  '日付が新しい順',
  '意味の近さ順',
  '1件', '2件', '3件', '5件', '10件', '20件',
]);

function assertChoicesFromCandidates(questions, candidateValues) {
  const allowed = new Set([...candidateValues, ...fixedDescriptions]);
  // A follow-up with previous content asks contentCarry instead of the content yes/no question.
  const contentQuestion = questions.content ?? questions.contentCarry;
  assert.equal(Boolean(contentQuestion), true);
  if (questions.content) assert.deepEqual(Object.keys(questions.content.criteria).sort(), ['false', 'true']);
  for (const [key, question] of Object.entries(questions)) {
    if (question.type === 'noul') continue;
    // Content span choices are parts of the request itself, cut by code.
    if (key === 'contentSpan') continue;
    if (key === 'cause') {
      assert.deepEqual(question.criteria, { ...Object.fromEntries(CAUSE_CATEGORIES.map(({ id, label, description }) => [id, `${label}: ${description}`])), none: '要因では絞らない' });
      continue;
    }
    // Carry questions have fixed keep/replace/add and same/new/none options, not values.
    if (key.startsWith('carry_') || key === 'contentCarry') continue;
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
    assert.equal(input.questions.turn, undefined);
    assert.equal(input.questions.drop_0.type, 'noul');
    assert.equal(input.questions.add_0.type, 'noul');
    assert.match(input.questions.drop_0.instructions, /Lathe-1/u);
    assert.deepEqual(Object.keys(input.questions.contentCarry.criteria), ['same', 'new']);
    assert.equal(input.questions.content, undefined);
    assertChoicesFromCandidates(input.questions, ['South Shop']);
    // The current utterance alone is judged; the previous plan is context only.
    assert.equal(input.state.request, 'South Shopも見る');
    assert.equal(input.state.previous_plan.filters[0].values[0], 'Lathe-1');
    for (const [id, question] of Object.entries(input.questions)) {
      assert.match(question.instructions, /`request`/u, `${id} names the current utterance`);
    }
    return {
      answers: {
        term_0: { type: 'choice', choice: 'v0' },
        drop_0: { type: 'noul', noul: 0.1 },
        add_0: { type: 'noul', noul: 0.1 },
        contentCarry: { type: 'choice', choice: 'same' },
        sort: { type: 'choice', choice: 'relevance' },
        limit: { type: 'choice', choice: '5' },
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
  assert.deepEqual(plan.diagnostics.contentDecision.residualTokens, ['surface', 'scratch']);
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
    residualTokens: ['qxrare'],
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

for (const content of [true, false]) {
  test(`a linked ambiguous department is dropped only for content questions (content=${content})`, async () => {
    const field = 'originDepartmentName';
    const values = ['第一設計課', '第二設計課', '第三設計課', '第四設計課'];
    const question = '設計課 干渉見落とし 原因';
    const evaluate = async () => ({ answers: {
      sort: { type: 'choice', choice: 'relevance' },
      limit: { type: 'choice', choice: '5' },
      content: { type: 'noul', noul: content },
    } });
    const { plan } = await createPlanner({ evaluate }).plan({
      question,
      catalog,
      choiceGroups: [{ source: 'nonconformity', field, term: '設計課', values, decision: 'clarify' }],
    });
    assert.equal(plan.filters.some((filter) => filter.field === field), false);
    assert.deepEqual(plan.unresolved, content ? [] : [{ term: field, candidates: values }]);
    assert.equal(plan.semanticQuery, content ? question : '');
    if (content) {
      assert.deepEqual(plan.diagnostics.ambiguousDropped, [{ field, candidates: values }]);
      assert.equal(plan.diagnostics.contentDecision.residualTokens.includes('設計課'), true);
    } else {
      assert.equal(Object.hasOwn(plan.diagnostics, 'ambiguousDropped'), false);
    }
  });
}

test('a low-confidence department value is dropped for a content question', async () => {
  const value = '北海工場製造部機械課';
  const question = '北海の機戒課 干渉見落とし 原因';
  const { plan } = await createPlanner({ evaluate: departmentAnswers({ value: 0.26, none: 0.29 }, true) }).plan({
    question,
    catalog,
    valueIndex: buildValueIndex([{ id: 'a', originDepartmentName: value }], catalog),
  });
  assert.deepEqual(plan.unresolved, []);
  assert.equal(plan.semanticQuery, question);
  assert.deepEqual(plan.filters, []);
  assert.deepEqual(plan.diagnostics.ambiguousDropped, [{ field: 'originDepartmentName', candidates: [value] }]);
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


test('the planner receipt maps a field choice to its value and keeps top probabilities', () => {
  const questions = {
    field_0: { type: 'choice', instructions: 'x', criteria: { v0: 'South Shop', none: 'この語は絞り込み条件にしない' } },
    contentCarry: { type: 'choice', instructions: 'x', criteria: { same: 'a', new: 'b' } },
    content: { type: 'noul', instructions: 'x', criteria: { true: 'a', false: 'b' } },
    limit: { type: 'choice', instructions: 'x', criteria: { 2: '2件' } },
  };
  const summary = summarizeAnswers(questions, {
    field_0: { type: 'choice', choice: 'v0', confidence: 0.91234, probabilities: { v0: 0.9, none: 0.1 } },
    contentCarry: { type: 'choice', choice: 'same' },
    content: { type: 'noul', noul: 0.12345 },
  });
  assert.deepEqual(summary.field_0, { choice: 'South Shop', confidence: 0.912, top: [['South Shop', 0.9], ['この語は絞り込み条件にしない', 0.1]] });
  assert.deepEqual(summary.contentCarry, { choice: 'same' });
  assert.deepEqual(summary.content, { noul: 0.123 });
  assert.deepEqual(summary.limit, { missing: true });
});

test('a follow-up that does not restate its content keeps the previous content condition', async () => {
  const evaluate = async () => ({
    answers: {
      term_0: { type: 'choice', choice: 'v0' },
      contentCarry: { type: 'choice', choice: 'same' },
      sort: { type: 'choice', choice: 'relevance' },
      limit: { type: 'choice', choice: '5' },
      content: { type: 'noul', noul: 0.1 },
    },
  });
  const previousPlan = { sources: ['nonconformity'], filters: [], semanticQuery: 'rust on the table please', contentSpan: 'rust on the table', sort: 'relevance', limit: 5 };
  const candidates = [{ term: 'South Shop', source: 'nonconformity', field: 'originDepartmentName', values: ['South Shop'] }];
  const refined = await createPlanner({ evaluate }).plan({ question: 'South Shopの不適合', previousPlan, catalog, candidates });
  assert.equal(refined.plan.semanticQuery, 'rust on the table please');
  assert.deepEqual(refined.plan.diagnostics.contentDecision.residualTokens, []);
  assert.equal(refined.plan.diagnostics.contentDecision.residualOverride, undefined);
  // The judge reads the same content part as on the previous turn.
  assert.equal(refined.plan.diagnostics.contentSpan, 'rust on the table');
  assert.equal(refined.plan.filters.some((filter) => filter.values[0] === 'South Shop'), true);
  const fresh = await createPlanner({ evaluate }).plan({ question: 'South Shopの不適合', previousPlan: null, catalog, candidates });
  assert.equal(fresh.plan.semanticQuery, '');
});

test('each previous condition is kept, replaced, added to, or dropped on its own', async () => {
  const previousPlan = {
    sources: ['nonconformity'],
    filters: [
      { source: 'nonconformity', field: 'originDepartmentName', op: 'eq', values: ['North Shop'] },
      { source: 'nonconformity', field: 'machineName', op: 'eq', values: ['Lathe-1'] },
    ],
    semanticQuery: 'paint peeling',
    sort: 'relevance',
    limit: 3,
  };
  const candidates = [{ term: 'South Shop', source: 'nonconformity', field: 'originDepartmentName', values: ['South Shop'] }];
  const run = ({ term = 'v0', add0 = 0.1, drop1 = 0.1, content = 'same' }) => createPlanner({
    evaluate: async (input) => {
      assert.deepEqual(Object.keys(input.questions).filter((key) => /^(?:drop|add)_/u.test(key)).sort(), ['add_0', 'add_1', 'drop_0', 'drop_1']);
      return {
        answers: {
          term_0: { type: 'choice', choice: term },
          drop_0: { type: 'noul', noul: 0.1 },
          add_0: { type: 'noul', noul: add0 },
          drop_1: { type: 'noul', noul: drop1 },
          add_1: { type: 'noul', noul: 0.1 },
          contentCarry: { type: 'choice', choice: content },
          sort: { type: 'choice', choice: 'relevance' },
          limit: { type: 'choice', choice: '5' },
        },
      };
    },
  }).plan({ question: 'South Shopでは', previousPlan, catalog, candidates });
  const values = (plan, field) => plan.filters.filter((filter) => filter.field === field).flatMap((filter) => filter.values).sort();

  // A new value for the same field replaces the previous one; an untouched condition stays.
  const replaced = (await run({})).plan;
  assert.deepEqual(values(replaced, 'originDepartmentName'), ['South Shop']);
  assert.deepEqual(values(replaced, 'machineName'), ['Lathe-1']);
  assert.equal(replaced.semanticQuery, 'paint peeling');

  const added = (await run({ add0: 0.9, drop1: 0.9, content: 'new' })).plan;
  assert.deepEqual(values(added, 'originDepartmentName'), ['North Shop', 'South Shop']);
  assert.deepEqual(values(added, 'machineName'), []);
  assert.equal(added.semanticQuery, '');
  assert.equal(added.diagnostics.contentDecision.residualOverride, true);

  // With no new value, the previous department stays unless the request drops it.
  const kept = (await run({ term: 'none' })).plan;
  assert.deepEqual(values(kept, 'originDepartmentName'), ['North Shop']);
});

test('a first turn keeps the original question wording and sends no previous plan', async () => {
  let seen = null;
  const evaluate = async (input) => {
    seen = input;
    return { answers: { term_0: { type: 'choice', choice: 'v0' }, sort: { type: 'choice', choice: 'recent' }, limit: { type: 'choice', choice: '5' }, content: { type: 'noul', noul: 0.1 } } };
  };
  await createPlanner({ evaluate }).plan({
    question: 'South Shopの不適合',
    previousPlan: null,
    catalog,
    candidates: [{ term: 'South Shop', source: 'nonconformity', field: 'originDepartmentName', values: ['South Shop'] }],
  });
  assert.equal('previous_plan' in seen.state, false);
  for (const question of Object.values(seen.questions)) assert.doesNotMatch(question.instructions, /`request`/u);
  assert.match(seen.questions.content.instructions, /^質問は、/u);
});

test('the planner asks about records already shown only after an answer showed some', async () => {
  const seen = [];
  const evaluate = async (input) => {
    seen.push(input.questions);
    return { answers: { excludeShown: { type: 'noul', noul: 0.9 }, content: { type: 'noul', noul: 0.9 }, limit: { type: 'choice', choice: '5' }, sort: { type: 'choice', choice: 'relevance' }, turn: { type: 'choice', choice: 'new_search' } } };
  };
  const planner = createPlanner({ evaluate });
  const previousPlan = { sources: ['nonconformity'], filters: [], semanticQuery: 'x', sort: 'relevance', limit: 5 };
  const none = await planner.plan({ question: 'q', previousPlan, catalog, candidates: [], shownCount: 0 });
  const some = await planner.plan({ question: 'q', previousPlan, catalog, candidates: [], shownCount: 2 });
  assert.equal('excludeShown' in seen[0], false);
  assert.equal(seen[1].excludeShown.type, 'noul');
  assert.equal(none.plan.diagnostics.excludeShown, undefined);
  assert.equal(some.plan.diagnostics.excludeShown, true);
});

test('the planner picks the content part of a question and keeps it in the plan', async () => {
  let seen = null;
  const evaluate = async (input) => {
    seen = input.questions;
    return { answers: { contentSpan: { type: 'choice', choice: 's0' }, content: { type: 'noul', noul: 0.9 }, limit: { type: 'choice', choice: '5' }, sort: { type: 'choice', choice: 'relevance' } } };
  };
  const { plan } = await createPlanner({ evaluate }).plan({ question: 'ハンディライトを是正にした案件はほかにある？', previousPlan: null, catalog, candidates: [] });
  assert.deepEqual(Object.values(seen.contentSpan.criteria), ['ハンディライトを是正にした案件', 'ほかにある', 'ハンディライトを是正にした案件はほかにある']);
  assert.equal(plan.diagnostics.contentSpan, 'ハンディライトを是正にした案件');
  const single = await createPlanner({ evaluate }).plan({ question: 'テーブルに傷がついた不適合', previousPlan: null, catalog, candidates: [] });
  assert.equal(single.plan.diagnostics.contentSpan, undefined);
});

for (const pointer of ['この', '現在の', 'いまの', '今の']) {
  test(`page context supplies a part filter only for ${pointer}`, async () => {
    let state;
    const planner = createPlanner({ evaluate: async (input) => {
      state = input.state;
      return { answers: { scope: { type: 'choice', choice: 'nonconformity' }, content: { type: 'noul', noul: false }, limit: { type: 'choice', choice: 'unspecified' } } };
    } });
    const pageContext = { path: '/kiosk/part-measurement/self-inspection', entity: { kind: 'partNumber', value: 'FH001' } };
    const { plan, receipt } = await planner.plan({ question: `${pointer}品番の不適合`, catalog, valueIndex: buildValueIndex([], catalog), pageContext });
    assert.deepEqual(state.page_context, pageContext.entity);
    assert.equal(JSON.stringify(state).includes(pageContext.path), false);
    assert.deepEqual(plan.filters, [{ source: 'nonconformity', field: 'partNumber', op: 'eq', values: ['FH001'] }]);
    assert.deepEqual(receipt.pageContext, { used: true, ...pageContext.entity });
    const ignored = await planner.plan({ question: '溶接の不適合', catalog, valueIndex: buildValueIndex([], catalog), pageContext });
    assert.equal('page_context' in state, false);
    assert.deepEqual(ignored.plan.filters, []);
    assert.deepEqual(ignored.receipt.pageContext, { used: false, ...pageContext.entity });
  });
}

test('page context maps record numbers and drawing numbers, and procedure ids only hint the source', async () => {
  const allCatalog = loadCatalog(['nonconformity', 'knowledge_procedure']);
  const planner = createPlanner({ evaluate: async () => ({ answers: {
    scope: { type: 'choice', choice: 'nonconformity' }, content: { type: 'noul', noul: false }, limit: { type: 'choice', choice: 'unspecified' },
  } }) });
  for (const [kind, source] of [['nonconformityNo', 'nonconformity'], ['drawingNumber', 'knowledge_procedure'], ['procedureId', 'knowledge_procedure']]) {
    const { plan, receipt } = await planner.plan({ question: 'この記録', catalog: allCatalog, valueIndex: buildValueIndex([], allCatalog), pageContext: { path: '/page', entity: { kind, value: 'screen-value' } } });
    assert.deepEqual(plan.sources, [source]);
    assert.deepEqual(plan.filters, kind === 'procedureId' ? [] : [{ source, field: kind, op: 'eq', values: ['screen-value'] }]);
    assert.equal(receipt.pageContext.used, true);
  }
  const unavailable = await planner.plan({ question: 'この手順書', catalog, valueIndex: buildValueIndex([], catalog), pageContext: { path: '/page', entity: { kind: 'procedureId', value: 'id' } } });
  assert.equal(unavailable.receipt.pageContext.used, false);
});

for (const [id, question, content] of [
  ['drawing', '図面の誤りで先月の不適合', false],
  ['assume', '思い込みが原因のやつ、今年', false],
  ['drawing', '図面の誤りで寸法抜け', true],
  ...CAUSE_CATEGORIES.map(({ id, label }) => [id, `${label}が原因の最近の不適合`, false]),
]) {
  test(`cause ${id} retains content=${content} with only one evaluation`, async () => {
    let calls = 0;
    const { plan } = await createPlanner({ evaluate: async input => {
      calls += 1;
      assert.equal(input.questions.cause.type, 'choice');
      assert.equal(Object.keys(input.questions.cause.criteria).length, 11);
      assert.match(input.questions.cause.instructions, /質問/u);
      assert.equal(input.questions.drop_cause, undefined);
      return { answers: {
        cause: { type: 'choice', choice: id }, content: { type: 'noul', noul: true },
        limit: { type: 'choice', choice: '5' },
      } };
    } }).plan({ question, catalog, now: '2026-10-19' });
    assert.equal(calls, 1);
    assert.equal(plan.causeCategory, id);
    assert.equal(plan.semanticQuery, content ? question : '');
    assert.equal(plan.diagnostics.contentDecision.jev, content);
    assert.deepEqual(plan.diagnostics.contentDecision.residualTokens, content ? ['寸法抜け'] : []);
    assert.deepEqual(plan.diagnostics.causeDecision, { chosen: id });
    if (question.includes('先月')) assert.deepEqual(plan.filters[0].values, ['2026-09-01', '2026-09-30']);
  });
}

for (const choice of ['none', undefined]) {
  test(`cause ${choice ?? 'missing'} leaves the first plan unfiltered`, async () => {
    const { plan } = await createPlanner({ evaluate: async () => ({ answers: {
      ...(choice ? { cause: { type: 'choice', choice } } : {}),
      content: { type: 'noul', noul: true }, limit: { type: 'choice', choice: '5' },
    } }) }).plan({ question: '図面の不適合', catalog });
    assert.equal(Object.hasOwn(plan, 'causeCategory'), false);
    assert.equal(plan.semanticQuery, '図面の不適合');
    assert.deepEqual(plan.diagnostics.causeDecision, { chosen: null });
  });
}

for (const [choice, drop, expected] of [['none', false, 'drawing'], [undefined, false, 'drawing'], ['none', true, null], ['assume', false, 'assume'], ['assume', true, 'assume']]) {
  test(`previous cause with choice=${choice ?? 'missing'} drop=${drop}`, async () => {
    const { plan } = await createPlanner({ evaluate: async input => {
      assert.equal(input.state.previous_plan.causeCategory, 'drawing');
      assert.match(input.questions.cause.instructions, /`request`/u);
      assert.match(input.questions.drop_cause.instructions, /要因が図面・設計の誤り/u);
      return { answers: {
        ...(choice ? { cause: { type: 'choice', choice } } : {}),
        drop_cause: { type: 'noul', noul: drop ? 0.9 : 0.1 },
        content: { type: 'noul', noul: false }, limit: { type: 'choice', choice: '5' },
      } };
    } }).plan({ question: '今年', catalog, now: '2026-10-19', previousPlan: { sources: ['nonconformity'], filters: [], semanticQuery: '', causeCategory: 'drawing' } });
    assert.equal(plan.causeCategory ?? null, expected);
    assert.equal(plan.semanticQuery, '');
    assert.deepEqual(plan.diagnostics.causeDecision, { chosen: expected, ...(drop ? { dropped: true } : {}) });
  });
}

test('a cause heard in a question scoped to another source does not become a filter', async () => {
  const allCatalog = loadCatalog(['nonconformity', 'knowledge_procedure']);
  const planner = createPlanner({ evaluate: async () => ({ answers: {
    scope: { type: 'choice', choice: 'knowledge_procedure' }, cause: { type: 'choice', choice: 'drawing' },
    content: { type: 'noul', noul: true }, limit: { type: 'choice', choice: 'unspecified' }, sort: { type: 'choice', choice: 'relevance' },
  } }) });
  const { plan } = await planner.plan({ question: '図面の誤りがあったときの手順', catalog: allCatalog, valueIndex: buildValueIndex([], allCatalog) });
  assert.deepEqual(plan.sources, ['knowledge_procedure']);
  assert.equal(Object.hasOwn(plan, 'causeCategory'), false);
  assert.equal(plan.diagnostics.causeDecision.chosen, null);
  assert.equal(plan.diagnostics.contentDecision.jev, true);
});
