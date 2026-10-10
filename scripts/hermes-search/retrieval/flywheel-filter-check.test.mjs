import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFilterAnswer, expectedFilterResults, isFilterOnlyPlan } from './flywheel-filter-check.mjs';
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

test('any unsupported op or non-recent sort leaves the answer unscored', () => {
  for (const op of ['gte', 'lte', 'contains', 'not_in']) {
    const extra = { filters: [...plan.filters, { field: 'discoveredOn', op, values: ['2026-10-01'] }] };
    assert.deepEqual(expected(extra), { supported: false, reason: `op:${op}` });
    const result = check(['a'], extra);
    assert.equal(result.supported, false);
    assert.equal(result.ok, null);
    assert.equal(result.reason, `op:${op}`);
  }
  for (const sort of [undefined, null, 'relevance', { field: 'discoveredOn', direction: 'asc' }]) {
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
