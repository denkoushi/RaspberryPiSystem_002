import { catalogEntries } from './catalog.mjs';
import { bareId } from './flywheel-pairs.mjs';

const normalize = (value) => String(value).normalize('NFKC').trim();
const recentSort = (sort) => sort === 'recent' || sort?.direction === 'desc';

export function isFilterOnlyPlan(plan) {
  return Boolean(plan && (plan.semanticQuery == null || plan.semanticQuery === '')
    && (plan.filters?.length > 0 || recentSort(plan.sort)));
}

function matchesFilters(record, filters) {
  return filters.every((filter) => {
    if (['between', 'after', 'before'].includes(filter.op)) {
      const text = String(record[filter.field] ?? '');
      if (!text) return false;
      const bounds = [...filter.values].sort();
      if (filter.op === 'after') return text > bounds[0];
      if (filter.op === 'before') return text < bounds[0];
      return text >= bounds[0] && text <= bounds[bounds.length - 1];
    }
    return (filter.values ?? []).some((value) => normalize(record[filter.field]) === normalize(value));
  });
}

export function expectedFilterResults({ plan, records, catalog }) {
  const filters = plan?.filters ?? [];
  const dateFields = catalogEntries(catalog).flatMap((entry) => entry.fields).filter((field) => field.role === 'date').map((field) => field.key);
  for (const filter of filters) {
    if (filter.op === 'eq' || filter.op === 'in') continue;
    if (!['between', 'after', 'before'].includes(filter.op)) return { supported: false, reason: `op:${filter.op}` };
    if (!dateFields.includes(filter.field)) return { supported: false, reason: `date_field:${filter.field}` };
    if (!Array.isArray(filter.values) || filter.values.length !== (filter.op === 'between' ? 2 : 1)
      || !filter.values.every((value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value))) {
      return { supported: false, reason: `date_bounds:${filter.field}` };
    }
  }
  if (!recentSort(plan?.sort)) return { supported: false, reason: 'sort' };
  const dateField = dateFields[0];
  const matched = records.filter((record) => matchesFilters(record, filters));
  matched.sort((left, right) => String(right[dateField] ?? '').localeCompare(String(left[dateField] ?? ''))
    || bareId(left.id).localeCompare(bareId(right.id)));
  const limit = Number.isInteger(plan.limit) && plan.limit > 0 ? plan.limit : 5;
  return { supported: true, matchedCount: matched.length, expectedIds: matched.slice(0, limit).map((record) => bareId(record.id)), limit };
}

/** Live failures and clarifications are separate from deterministic answer mismatches. */
export function filterOutcome({ live, filterCheck }) {
  if (live?.outcome === 'clarification') return 'clarified';
  if (!live || live.outcome === 'failed' || live.outcome === 'unavailable') return 'failed';
  if (filterCheck?.supported !== true) return 'unsupported';
  return ['answer', 'no_result', 'no_other'].includes(live.outcome) && filterCheck.ok === true ? 'ok' : 'mismatch';
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
