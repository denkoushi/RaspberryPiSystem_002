import { BREAKDOWN_AXES } from './query-plan.mjs';
import { catalogEntries } from './catalog.mjs';
import { CAUSE_CATEGORY_IDS } from './cause-categories.mjs';
import { bareId } from './flywheel-pairs.mjs';

const normalize = (value) => String(value).normalize('NFKC').trim();
const recentSort = (sort) => sort === 'recent' || sort?.direction === 'desc';

export function isFilterOnlyPlan(plan) {
  return Boolean(plan && (plan.semanticQuery == null || plan.semanticQuery === '')
    && (BREAKDOWN_AXES.includes(plan.breakdown) || plan.filters?.length > 0 || CAUSE_CATEGORY_IDS.includes(plan.causeCategory) || recentSort(plan.sort)));
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

function matchesCause(record, plan, causeById) {
  return !plan.causeCategory || causeById?.get(record.id) === plan.causeCategory;
}

export function expectedFilterResults({ plan, records, catalog, causeById = null }) {
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
  const defaultRecent = isFilterOnlyPlan(plan) && (plan.sort === 'relevance' || !plan.sort);
  if (!recentSort(plan?.sort) && !defaultRecent) return { supported: false, reason: 'sort' };
  const dateField = dateFields[0];
  const matched = records.filter((record) => matchesFilters(record, filters) && matchesCause(record, plan, causeById));
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

export function checkFilterAnswer({ plan, shown = [], groups = [], breakdown = plan?.breakdown, records, catalog, causeById = null }) {
  const expected = expectedFilterResults({ plan, records, catalog, causeById });
  const ids = shown.map(bareId);
  if (!expected.supported) {
    return { ...expected, filtersOk: null, orderOk: null, countOk: null, ok: null, expectedIds: [], shown: ids, matchedCount: null };
  }
  const byId = new Map(records.map((record) => [bareId(record.id), record]));
  const filtersOk = ids.every((id) => byId.has(id) && matchesFilters(byId.get(id), plan.filters ?? []) && matchesCause(byId.get(id), plan, causeById));
  const orderOk = ids.every((id, index) => id === expected.expectedIds[index]);
  const countOk = ids.length === Math.min(expected.limit, expected.matchedCount);
  let bucketsOk;
  if (breakdown === 'cause') {
    const counts = new Map();
    for (const record of records) {
      if (!matchesFilters(record, plan.filters ?? []) || !matchesCause(record, plan, causeById)) continue;
      const value = causeById?.get(record.id);
      if (CAUSE_CATEGORY_IDS.includes(value)) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const buckets = groups.find(group => group.axis === 'cause')?.buckets;
    bucketsOk = plan.breakdown === 'cause' && Array.isArray(buckets) && buckets.length === counts.size
      && new Set(buckets.map(bucket => bucket.value)).size === buckets.length
      && buckets.every(bucket => counts.get(bucket.value) === bucket.count);
  }
  return { supported: true, filtersOk, orderOk, countOk,
    ...(breakdown === 'cause' ? { bucketsOk } : {}),
    ok: breakdown === 'cause' ? bucketsOk : filtersOk && orderOk && countOk,
    expectedIds: expected.expectedIds, shown: ids, matchedCount: expected.matchedCount };
}
