import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFollowUpAnswer, checkFilterAnswer, expectedFilterResults, followUpLoss, isFilterOnlyPlan } from './flywheel-filter-check.mjs';
import { nextIsoDay, parsePeriods, previousIsoDay } from './period-parse.mjs';

const catalog = { id: 'nonconformity', fields: [
  { key: 'originDepartmentName', role: 'organization' },
  { key: 'discoveredOn', role: 'date' },
  { key: 'updatedOn', role: 'date' },
] };
const records = [
  { id: 'nonconformity:b', originDepartmentName: ' North Shop ', discoveredOn: '2026-10-06', updatedOn: '2026-10-08' },
  { id: 'a', originDepartmentName: 'Ｎｏｒｔｈ　Ｓｈｏｐ', discoveredOn: '2026-10-06', updatedOn: '2026-10-01' },
  { id: 'c', originDepartmentName: 'North Shop', discoveredOn: '2026-10-05' },
  { id: 'd', originDepartmentName: 'South Shop', discoveredOn: '2026-10-07' },
];
const plan = { filters: [{ field: 'originDepartmentName', op: 'eq', values: ['North Shop'] }], semanticQuery: '', sort: { field: 'discoveredOn', direction: 'desc' }, limit: 2 };
const expected = (extra = {}) => expectedFilterResults({ plan: { ...plan, ...extra }, records, catalog });
const check = (shown, extra = {}) => checkFilterAnswer({ plan: { ...plan, ...extra }, shown, records, catalog });

test('filter-only plans need empty content and a filter or recent sort', () => {
  for (const value of [null, undefined, {}, { semanticQuery: '', filters: [] }, { ...plan, semanticQuery: 'scratch' }]) {
    assert.equal(isFilterOnlyPlan(value), false);
  }
  for (const value of [plan, { filters: plan.filters }, { semanticQuery: '', sort: 'recent' }, { sort: plan.sort }]) {
    assert.equal(isFilterOnlyPlan(value), true);
  }
});

test('eq uses normalized exact values and recent order breaks same-day ties by bare id', () => {
  const original = structuredClone(records);
  assert.deepEqual(expected(), { supported: true, matchedCount: 3, expectedIds: ['a', 'b'], limit: 2 });
  assert.deepEqual(records, original);
  assert.deepEqual(expected({ sort: 'recent', limit: 1 }).expectedIds, ['a']);
  assert.deepEqual(expected({ limit: 10 }).expectedIds, ['a', 'b', 'c']);
});

test('in, multiple filters and unfiltered recent queries use the same expected ranking', () => {
  assert.deepEqual(expected({ filters: [{ field: 'originDepartmentName', op: 'in', values: ['North Shop', 'South Shop'] }] }).expectedIds, ['d', 'a']);
  assert.deepEqual(expected({ filters: [...plan.filters, { field: 'id', op: 'in', values: ['a', 'c'] }] }),
    { supported: true, matchedCount: 2, expectedIds: ['a', 'c'], limit: 2 });
  assert.deepEqual(expected({ filters: [] }).expectedIds, ['d', 'a']);
  assert.equal(expected({ filters: [{ ...plan.filters[0], values: ['North'] }] }).matchedCount, 0);
});

test('missing or invalid limits default to five, and zero matches expect no ids', () => {
  for (const limit of [undefined, null, 0, -1, 1.5, '2']) {
    assert.deepEqual(expected({ limit }), { supported: true, matchedCount: 3, expectedIds: ['a', 'b', 'c'], limit: 5 });
  }
  assert.deepEqual(expected({ filters: [{ ...plan.filters[0], values: [] }] }), { supported: true, matchedCount: 0, expectedIds: [], limit: 2 });
});

test('filter-only relevance or missing sort uses the first date field descending', () => {
  for (const sort of ['relevance', undefined, null]) {
    for (const semanticQuery of ['', undefined]) {
      assert.deepEqual(expected({ sort, semanticQuery }), { supported: true, matchedCount: 3, expectedIds: ['a', 'b'], limit: 2 });
      assert.equal(check(['a', 'b'], { sort, semanticQuery }).ok, true);
    }
  }
});

test('content relevance or missing sort stays unsupported', () => {
  for (const sort of ['relevance', undefined, null]) {
    assert.deepEqual(expected({ sort, semanticQuery: 'scratch' }), { supported: false, reason: 'sort' });
  }
  assert.deepEqual(expected({ filters: [], sort: 'relevance' }), { supported: false, reason: 'sort' });
});

test('any unsupported op or ascending sort leaves the answer unscored', () => {
  for (const op of ['gte', 'lte', 'contains', 'not_in']) {
    const extra = { filters: [...plan.filters, { field: 'discoveredOn', op, values: ['2026-10-01'] }] };
    assert.deepEqual(expected(extra), { supported: false, reason: `op:${op}` });
    const result = check(['a'], extra);
    assert.equal(result.supported, false);
    assert.equal(result.ok, null);
    assert.equal(result.reason, `op:${op}`);
  }
  for (const sort of [{ field: 'discoveredOn', direction: 'asc' }]) {
    assert.deepEqual(expected({ sort }), { supported: false, reason: 'sort' });
    assert.equal(check([], { sort }).ok, null);
  }
});

test('correct answers normalize shown ids and allow an empty result when nothing matches', () => {
  assert.deepEqual(check(['nonconformity:a', 'nonconformity:b']), {
    supported: true, filtersOk: true, orderOk: true, countOk: true, ok: true,
    expectedIds: ['a', 'b'], shown: ['a', 'b'], matchedCount: 3,
  });
  assert.equal(check([], { filters: [{ ...plan.filters[0], values: ['Missing Shop'] }] }).ok, true);
});

test('filter, order and count errors are checked independently', () => {
  assert.deepEqual(['filtersOk', 'orderOk', 'countOk', 'ok'].map((key) => check(['d', 'a'])[key]), [false, false, true, false]);
  assert.equal(check(['unknown', 'a']).filtersOk, false);
  assert.deepEqual(['filtersOk', 'orderOk', 'countOk', 'ok'].map((key) => check(['b', 'a'])[key]), [true, false, true, false]);
  assert.equal(check(['a', 'c']).orderOk, false);
  assert.deepEqual(['filtersOk', 'orderOk', 'countOk', 'ok'].map((key) => check(['a'])[key]), [true, true, false, false]);
  assert.equal(check(['a', 'b', 'c']).countOk, false);
  assert.equal(check(['a', 'a']).ok, false);
  assert.equal(check([]).ok, false);
});

test('period filters match the planner shape with inclusive between and exclusive shifted edges', () => {
  const corpus = [
    { id: 'before', originDepartmentName: 'North Shop', discoveredOn: '2026-08-31' },
    { id: 'first', originDepartmentName: 'North Shop', discoveredOn: '2026-09-01' },
    { id: 'last', originDepartmentName: 'North Shop', discoveredOn: '2026-09-30' },
    { id: 'after', originDepartmentName: 'North Shop', discoveredOn: '2026-10-01' },
    { id: 'missing', originDepartmentName: 'North Shop' },
    { id: 'wrong-department', originDepartmentName: 'South Shop', discoveredOn: '2026-09-15' },
  ];
  const bounds = parsePeriods('先月', '2026-10-10')[0].interpretations[0];
  const cases = [
    ['between', [bounds.from, bounds.to], ['last', 'first']],
    ['between', [bounds.to, bounds.from], ['last', 'first']],
    ['after', [previousIsoDay(bounds.from)], ['after', 'last', 'first']],
    ['before', [nextIsoDay(bounds.to)], ['last', 'first', 'before']],
  ];
  for (const [op, values, expectedIds] of cases) {
    const datedPlan = { ...plan, limit: 10, filters: [...plan.filters, { source: 'nonconformity', field: 'discoveredOn', op, values }] };
    assert.deepEqual(expectedFilterResults({ plan: datedPlan, records: corpus, catalog }).expectedIds, expectedIds);
    assert.equal(checkFilterAnswer({ plan: datedPlan, shown: expectedIds, records: corpus, catalog }).ok, true);
    assert.equal(checkFilterAnswer({ plan: datedPlan, shown: ['missing'], records: corpus, catalog }).filtersOk, false);
  }
  const datedPlan = { ...plan, filters: [...plan.filters, { field: 'discoveredOn', op: 'between', values: [bounds.from, bounds.to] }] };
  assert.equal(checkFilterAnswer({ plan: datedPlan, shown: ['after', 'first'], records: corpus, catalog }).filtersOk, false);
  assert.equal(checkFilterAnswer({ plan: datedPlan, shown: ['first', 'last'], records: corpus, catalog }).orderOk, false);
  assert.equal(checkFilterAnswer({ plan: datedPlan, shown: ['last'], records: corpus, catalog }).countOk, false);
});

test('date ranges on non-date fields and malformed bounds are explicitly unsupported', () => {
  assert.deepEqual(expected({ filters: [{ field: 'originDepartmentName', op: 'between', values: ['A', 'Z'] }] }),
    { supported: false, reason: 'date_field:originDepartmentName' });
  for (const values of [[], ['2026-10-01'], ['bad', '2026-10-01'], null]) {
    assert.deepEqual(expected({ filters: [{ field: 'discoveredOn', op: 'between', values }] }),
      { supported: false, reason: 'date_bounds:discoveredOn' });
  }
});

test('cause filtering composes with catalog filters and keeps original record id keys', () => {
  const causeById = new Map([['nonconformity:b', 'drawing'], ['a', 'check'], ['d', 'drawing']]);
  const causePlan = { ...plan, causeCategory: 'drawing' };
  const expected = expectedFilterResults({ plan: causePlan, records, catalog, causeById });
  assert.deepEqual(expected.expectedIds, ['b']);
  assert.equal(expected.matchedCount, 1);
  assert.equal(checkFilterAnswer({ plan: causePlan, records, catalog, causeById, shown: ['nonconformity:b'] }).ok, true);
  for (const id of ['a', 'c', 'd']) {
    assert.equal(checkFilterAnswer({ plan: causePlan, records, catalog, causeById, shown: [id] }).filtersOk, false);
  }
  assert.equal(expectedFilterResults({ plan: causePlan, records, catalog }).matchedCount, 0);
  const causeOnly = { causeCategory: 'drawing', semanticQuery: '', filters: [] };
  assert.equal(isFilterOnlyPlan(causeOnly), true);
  assert.equal(isFilterOnlyPlan({ ...causeOnly, causeCategory: 'invalid' }), false);
  assert.deepEqual(expectedFilterResults({ plan: causeOnly, records, catalog, causeById }).expectedIds, ['d', 'b']);
});

test('cause breakdown compares bucket values and counts independently of shown records', () => {
  const causeById = new Map([['nonconformity:b', 'drawing'], ['a', 'check'], ['d', 'drawing']]);
  const breakdownPlan = { ...plan, breakdown: 'cause', filters: [...plan.filters,
    { field: 'discoveredOn', op: 'between', values: ['2026-10-06', '2026-10-06'] }] };
  const args = { plan: breakdownPlan, records, catalog, causeById, shown: ['d'] };
  const buckets = [{ value: 'drawing', count: 1 }, { value: 'check', count: 1 }];
  const checked = checkFilterAnswer({ ...args, groups: [{ axis: 'cause', buckets }] });
  assert.equal(checked.ok, true);
  assert.equal(checked.bucketsOk, true);
  assert.equal(checked.filtersOk, false);
  assert.equal(checked.orderOk, false);
  assert.equal(checked.countOk, false);
  for (const wrong of [[], buckets.slice(0, 1), [...buckets, buckets[0]], [{ value: 'drawing', count: 2 }, buckets[1]], [{ value: 'assume', count: 1 }, buckets[1]]]) {
    assert.equal(checkFilterAnswer({ ...args, groups: [{ axis: 'cause', buckets: wrong }] }).ok, false);
  }
  assert.equal(checkFilterAnswer(args).ok, false);
  assert.equal(checkFilterAnswer({ ...args, plan: { ...breakdownPlan, breakdown: undefined }, breakdown: 'cause', shown: ['a', 'b'] }).ok, false);
  assert.equal(checkFilterAnswer({ ...args, plan: { ...breakdownPlan, causeCategory: 'drawing' },
    groups: [{ axis: 'cause', buckets: buckets.slice(0, 1) }] }).ok, true);
  assert.equal(isFilterOnlyPlan({ breakdown: 'cause' }), true);
  assert.equal(isFilterOnlyPlan({ breakdown: 'invalid' }), false);
});

test('empty classified bucket sets require an explicit cause group', () => {
  const args = { plan: { ...plan, breakdown: 'cause' }, records, catalog, causeById: new Map([['outside', 'drawing']]) };
  assert.equal(checkFilterAnswer({ ...args, groups: [{ axis: 'cause', buckets: [] }] }).ok, true);
  assert.equal(checkFilterAnswer(args).ok, false);
});

// Entirely fictional departments and passages; two factories, two sections each.
const followCatalog = { id: 'nonconformity', fields: [{ key: 'originDepartmentName', role: 'organization' }] };
const departments = ['架空Ａ工場試作部一課', '架空Ａ工場試作部二課', '架空Ｂ工場検証部一課', '架空Ｂ工場検証部二課'];
const followRecords = Array.from({ length: 10 }, (_, i) => ({
  id: `nonconformity:fiction-${i}`, originDepartmentName: departments[i % 4],
  condition: i === 2 ? '異物の嚙み込みという架空の事象' : i === 3 ? '付着を確認したという架空の事象' : '通常状態という架空の事象',
}));
const org = (values, field = 'originDepartmentName', op = 'in') => ({ field, op, values });
const priorFollowPlan = { filters: [org([departments[0]])], semanticQuery: '異物 付着' };
const followPlan = { filters: [org(departments.slice(2))], semanticQuery: '別の語', diagnostics: { contentSpan: '異物の付着' } };
const followCheck = (extra = {}) => checkFollowUpAnswer({ question: '架空Ｂ工場にも同事例ありますか？', previousPlan: priorFollowPlan,
  plan: followPlan, shown: [], outcome: 'no_result', records: followRecords, catalog: followCatalog, bodyFields: ['condition'], ...extra });

test('follow-up scope uses normalized longest question match and shared factory/division hierarchy', () => {
  for (const question of ['架空Ｂ工場にも同事例？', '架空B工場検証部にも同事例？']) {
    const check = followCheck({ question, shown: ['fiction-3', 'nonconformity:fiction-2'], outcome: 'answer' });
    assert.equal(check.ok, true);
    assert.equal(check.matchedCount, 2);
    assert.deepEqual(check.expectedIds, ['fiction-2', 'fiction-3']);
  }
  const check = followCheck({ question: '架空B工場検証部一課にも？', plan: { ...followPlan, filters: [org([departments[2]])] }, shown: ['fiction-2'] });
  assert.equal(check.ok, true);
  assert.equal(check.matchedCount, 1);
  assert.equal(followCheck({ question: '架空B工場検証部一課にも？', shown: ['fiction-2'] }).scopeOk, false);
});

test('follow-up scope falls back to previous organization and accepts a genuinely empty result', () => {
  const plan = { ...followPlan, filters: priorFollowPlan.filters };
  const check = followCheck({ question: '同じ範囲で他にも？', plan });
  assert.equal(check.ok, true);
  assert.equal(check.matchedCount, 0);
  assert.equal(followCheck({ question: '同じ範囲で他にも？' }).scopeOk, false);
  assert.equal(followCheck({ question: '他にも？', previousPlan: { filters: [] }, plan: { ...followPlan, filters: [] }, shown: ['fiction-2'] }).ok, true);
});

test('follow-up detects stale, missing and empty scope even when displayed records fit the plan', () => {
  for (const filters of [priorFollowPlan.filters, [], [org([])]]) {
    const check = followCheck({ plan: { ...followPlan, filters } });
    assert.equal(check.scopeOk, false);
    assert.equal(check.filtersOk, true);
    assert.equal(check.ok, false);
  }
});

test('follow-up detects missed and wrong content but accepts one specific token without order or count matching', () => {
  const missed = followCheck();
  assert.equal(missed.scopeOk, true);
  assert.equal(missed.contentOk, false);
  assert.equal(missed.matchedCount, 2);
  for (const shown of [['fiction-0'], ['fiction-6'], ['missing']]) {
    const wrong = followCheck({ shown, outcome: 'answer' });
    assert.equal(wrong.contentOk, false);
    assert.equal(wrong.ok, false);
  }
  assert.equal(followCheck({ shown: ['fiction-2'], outcome: 'answer' }).ok, true);
  const records = followRecords.map((record, i) => i === 3 ? { ...record, part: 'absent' } : record);
  assert.equal(followCheck({ records, shown: ['fiction-2'], plan: { ...followPlan, filters: [...followPlan.filters, org(['absent'], 'part')] } }).filtersOk, false);
});

test('follow-up content falls back from diagnostics to plan span to semantic query with executor IDF', () => {
  for (const plan of [followPlan, { ...followPlan, diagnostics: undefined, contentSpan: '異物の付着' },
    { ...followPlan, diagnostics: undefined, semanticQuery: '異物 付着' }]) {
    assert.equal(followCheck({ plan, shown: ['fiction-2'] }).ok, true);
  }
  const generic = followCheck({ plan: { ...followPlan, diagnostics: undefined, semanticQuery: '通常状態' }, shown: ['fiction-6'] });
  assert.equal(generic.supported, false);
  assert.equal(generic.reason, 'no_specific_content');
  const empty = followCheck({ plan: { ...followPlan, diagnostics: undefined, semanticQuery: '通常状態' } });
  assert.equal(empty.contentOk, true);
  assert.equal(empty.ok, true);
  assert.equal(generic.contentOk, null);
});

test('follow-up strips standalone source labels before checking verbatim content', () => {
  const records = followRecords.map((record, i) => i === 0 ? { ...record, condition: '配管不良' }
    : i === 6 ? { ...record, condition: '不適合' } : record);
  const plan = { ...followPlan, diagnostics: { contentSpan: '配管不良の不適合' } };
  assert.deepEqual(followCheck({ records, plan, shown: ['fiction-6'] }), {
    supported: false, scopeOk: null, filtersOk: null, contentOk: null, ok: null,
    matchedCount: null, expectedIds: [], shown: ['fiction-6'], reason: 'no_verbatim_content',
  });
  const empty = followCheck({ records, plan });
  assert.equal(empty.ok, true);
  assert.equal(empty.matchedCount, 0);
  assert.equal(followCheck({ plan: { ...plan, diagnostics: { contentSpan: '不適合' } } }).reason, 'no_content');
});

test('follow-up removes scope organizations from content', () => {
  const records = followRecords.map((record, i) => ({ ...record, part: '架空部品Z',
    ...(i === 6 ? { condition: `${departments[2]} 架空部品Z` } : {}) }));
  for (const filters of [followPlan.filters, []]) {
    const plan = { ...followPlan, filters: [...filters, org(['架空部品Z'], 'part')],
      diagnostics: { contentSpan: `${departments[2]} 異物の不適合` } };
    const check = followCheck({ records, plan, shown: ['fiction-2'] });
    assert.equal(check.contentOk, true);
    assert.deepEqual(check.expectedIds, ['fiction-2']);
    const noContent = followCheck({ records, plan: { ...plan, diagnostics: { contentSpan: `${departments[2]} 不適合` } } });
    assert.equal(noContent.reason, 'no_content');
  }
});

test('follow-up preserves scope and filter violations when no verbatim content is available', () => {
  const records = followRecords.map((record, i) => i === 0 ? { ...record, condition: '配管破損' } : record);
  for (const contentSpan of ['配管破損の不適合', '通常状態']) {
    for (const [plan, shown, scopeOk, filtersOk, loss] of [
      [{ ...followPlan, filters: priorFollowPlan.filters }, ['fiction-0'], false, true, 'follow_up_scope'],
      [followPlan, ['fiction-0'], true, false, 'follow_up_wrong'],
    ]) {
      const check = followCheck({ records, plan: { ...plan, diagnostics: { contentSpan } }, shown });
      assert.deepEqual(check, { supported: true, scopeOk, filtersOk, contentOk: null,
        ok: false, matchedCount: 0, expectedIds: [], shown });
      assert.equal(followUpLoss(check, 'fallback'), loss);
    }
  }
});

test('follow-up retains content overlapping a non-organization filter value', () => {
  const records = followRecords.map((record, i) => ({ ...record, part: '配管破断',
    ...(i === 2 ? { condition: '配管破損' } : {}) }));
  const plan = { ...followPlan, filters: [...followPlan.filters, org(['配管破断'], 'part')],
    diagnostics: { contentSpan: '配管破損の不適合' } };
  const check = followCheck({ records, plan, shown: ['fiction-2'] });
  assert.equal(check.supported, true);
  assert.equal(check.contentOk, true);
  assert.equal(check.ok, true);
  assert.deepEqual(check.expectedIds, ['fiction-2']);
});

test('follow-up keeps content failures supported when filters or exclusions remove all matches', () => {
  const records = followRecords.map((record, i) => ({ ...record, part: i === 6 ? '対象部品' : '別部品' }));
  for (const extra of [
    { plan: { ...followPlan, filters: [...followPlan.filters, org(['対象部品'], 'part')] } },
    { plan: { ...followPlan, excludeShown: true }, previousShown: ['fiction-2', 'fiction-3'] },
  ]) {
    const check = followCheck({ records, shown: ['fiction-6'], ...extra });
    assert.equal(check.supported, true);
    assert.equal(check.scopeOk, true);
    assert.equal(check.filtersOk, true);
    assert.equal(check.contentOk, false);
    assert.equal(check.ok, false);
    assert.equal(check.matchedCount, 0);
    assert.deepEqual(check.expectedIds, []);
  }
});

test('follow-up reports unsupported reasons and null checks for count, no content, operators and first turns', () => {
  for (const [extra, reason] of [
    [{ outcome: 'count' }, 'count_answer'],
    [{ plan: { ...followPlan, diagnostics: undefined, semanticQuery: '' } }, 'no_content'],
    [{ plan: { ...followPlan, filters: [org(departments.slice(2), 'originDepartmentName', 'not')] } }, 'unsupported_op'],
    [{ previousPlan: null }, 'not_follow_up'],
  ]) {
    assert.deepEqual(followCheck(extra), { supported: false, scopeOk: null, filtersOk: null, contentOk: null,
      ok: null, matchedCount: null, expectedIds: [], shown: [], reason });
  }
});

test('follow-up rejects unsupported previous organization operators only when falling back', () => {
  for (const op of ['not_in', 'between', 'contains']) {
    const previousPlan = { ...priorFollowPlan, filters: [org(departments.slice(2), 'originDepartmentName', op)] };
    assert.deepEqual(followCheck({ question: '同じ範囲で他にも？', previousPlan, shown: ['nonconformity:fiction-2'] }), {
      supported: false, scopeOk: null, filtersOk: null, contentOk: null, ok: null,
      matchedCount: null, expectedIds: [], shown: ['fiction-2'], reason: 'unsupported_op',
    });
    assert.equal(followCheck({ previousPlan, shown: ['fiction-2'] }).ok, true);
  }
});

test('follow-up not_in excludes matching values and accepts different or missing values', () => {
  const records = followRecords.map((record, i) => ({ ...record, ...(i === 2 ? { part: ' 架空部品Ａ ' } : {}) }));
  const plan = { ...followPlan, filters: [...followPlan.filters, org(['架空部品A'], 'part', 'not_in')] };
  assert.equal(followCheck({ records, plan, shown: ['fiction-2'] }).filtersOk, false);
  for (const part of [undefined, null, '', '架空部品B']) {
    const corpus = records.map((record, i) => i === 3 ? { ...record, part } : record);
    const check = followCheck({ records: corpus, plan, shown: ['fiction-3'] });
    assert.equal(check.ok, true);
    assert.equal(check.matchedCount, 1);
    assert.deepEqual(check.expectedIds, ['fiction-3']);
  }
});

test('follow-up rejects unknown operators on any plan filter', () => {
  for (const field of ['originDepartmentName', 'part', 'discoveredOn']) {
    for (const op of ['contains', 'gte', 'not']) {
      const check = followCheck({ plan: { ...followPlan, filters: [...followPlan.filters, org(['架空値'], field, op)] } });
      assert.equal(check.supported, false);
      assert.equal(check.reason, 'unsupported_op');
      assert.equal(check.ok, null);
    }
  }
});

test('follow-up empty answers respect non-organization filters while scope remains question-derived', () => {
  const records = followRecords.map((record) => ({ ...record, discoveredOn: '2025-06-01', part: '架空部品A' }));
  for (const filter of [
    org(['2026-01-01', '2026-12-31'], 'discoveredOn', 'between'),
    org(['2026-01-01'], 'discoveredOn', 'after'),
    org(['2025-01-01'], 'discoveredOn', 'before'),
    org(['架空部品B'], 'part', 'eq'),
    org(['架空部品B', '架空部品C'], 'part', 'in'),
  ]) {
    const check = followCheck({ question: '架空Ｂ工場で2026年のものは？', records,
      plan: { ...followPlan, filters: [...followPlan.filters, filter] } });
    assert.equal(check.ok, true);
    assert.equal(check.matchedCount, 0);
    assert.deepEqual(check.expectedIds, []);
  }
  const stale = followCheck({ records, plan: { ...followPlan, filters: [...priorFollowPlan.filters,
    org(['2025-01-01', '2025-12-31'], 'discoveredOn', 'between')] } });
  assert.equal(stale.scopeOk, false);
  assert.equal(stale.matchedCount, 2);
  assert.deepEqual(stale.expectedIds, ['fiction-2', 'fiction-3']);
});

test('follow-up excludeShown removes previous bare ids only when explicitly enabled', () => {
  const plan = { ...followPlan, filters: [org([departments[2]])] };
  const args = { question: '同じ範囲で他にも？', previousPlan: plan };
  for (const extra of [{ excludeShown: true }, { diagnostics: { ...plan.diagnostics, excludeShown: true } },
    { excludeShown: false, diagnostics: { ...plan.diagnostics, excludeShown: true } }]) {
    for (const previousShown of [['fiction-2'], ['nonconformity:fiction-2']]) {
      const check = followCheck({ ...args, plan: { ...plan, ...extra }, previousShown });
      assert.equal(check.ok, true);
      assert.equal(check.matchedCount, 0);
      assert.deepEqual(check.expectedIds, []);
    }
    assert.equal(followCheck({ ...args, plan: { ...plan, ...extra } }).matchedCount, 1);
    assert.equal(followCheck({ ...args, plan: { ...plan, ...extra }, previousShown: ['fiction-3'] }).matchedCount, 1);
  }
  for (const excludeShown of [undefined, false, 'true']) {
    const check = followCheck({ ...args, plan: { ...plan, excludeShown }, previousShown: ['fiction-2'] });
    assert.equal(check.contentOk, false);
    assert.equal(check.matchedCount, 1);
  }
});

test('follow-up supports custom and default organization fields and caps expected bare ids at twenty', () => {
  const records = Array.from({ length: 25 }, (_, i) => ({ id: `nonconformity:${i}`, unit: '架空課', condition: '希少語' }));
  records.push(...Array.from({ length: 300 }, (_, i) => ({ id: `other-${i}`, unit: '別の架空課', condition: '通常語' })));
  const check = followCheck({ question: '架空課にも？', records, catalog: { id: 'nonconformity', fields: [{ key: 'unit', role: 'organization' }] },
    plan: { filters: [org(['架空課'], 'unit')], semanticQuery: '希少語' } });
  assert.equal(check.matchedCount, 25);
  assert.equal(check.expectedIds.length, 20);
  assert.equal(check.expectedIds[0], '0');
  assert.equal(followCheck({ catalog: { id: 'nonconformity', fields: [] }, shown: ['fiction-2'] }).ok, true);
});
