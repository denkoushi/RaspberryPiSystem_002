import { catalogEntries } from './catalog.mjs';
import { bareId } from './flywheel-pairs.mjs';

const normalize = (value) => String(value).normalize('NFKC').trim();
const recentSort = (sort) => sort === 'recent' || sort?.direction === 'desc';

export function isFilterOnlyPlan(plan) {
  return Boolean(plan && (plan.semanticQuery == null || plan.semanticQuery === '')
    && (plan.filters?.length > 0 || recentSort(plan.sort)));
}

function matchesFilters(record, filters) {
  return filters.every((filter) => (filter.values ?? []).some((value) => normalize(record[filter.field]) === normalize(value)));
}

export function expectedFilterResults({ plan, records, catalog }) {
  const filters = plan?.filters ?? [];
  for (const filter of filters) {
    if (filter.op !== 'eq' && filter.op !== 'in') return { supported: false, reason: `op:${filter.op}` };
  }
  if (!recentSort(plan?.sort)) return { supported: false, reason: 'sort' };
  const dateField = catalogEntries(catalog).flatMap((entry) => entry.fields).find((field) => field.role === 'date')?.key;
  const matched = records.filter((record) => matchesFilters(record, filters));
  matched.sort((left, right) => String(right[dateField] ?? '').localeCompare(String(left[dateField] ?? ''))
    || bareId(left.id).localeCompare(bareId(right.id)));
  const limit = Number.isInteger(plan.limit) && plan.limit > 0 ? plan.limit : 5;
  return { supported: true, matchedCount: matched.length, expectedIds: matched.slice(0, limit).map((record) => bareId(record.id)), limit };
}

export function checkFilterAnswer({ plan, shown = [], records, catalog }) {
  const expected = expectedFilterResults({ plan, records, catalog });
  const ids = shown.map(bareId);
  if (!expected.supported) {
    return { ...expected, filtersOk: null, orderOk: null, countOk: null, ok: null, expectedIds: [], shown: ids, matchedCount: null };
  }
  const byId = new Map(records.map((record) => [bareId(record.id), record]));
  const filtersOk = ids.every((id) => byId.has(id) && matchesFilters(byId.get(id), plan.filters ?? []));
  const orderOk = ids.every((id, index) => id === expected.expectedIds[index]);
  const countOk = ids.length === Math.min(expected.limit, expected.matchedCount);
  return { supported: true, filtersOk, orderOk, countOk, ok: filtersOk && orderOk && countOk,
    expectedIds: expected.expectedIds, shown: ids, matchedCount: expected.matchedCount };
}
