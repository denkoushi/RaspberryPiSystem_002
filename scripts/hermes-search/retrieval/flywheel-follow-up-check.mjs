import { checkFilterAnswer, isFilterOnlyPlan } from './flywheel-filter-check.mjs';
import { fieldsWithRole } from './catalog.mjs';
import { bareId } from './flywheel-pairs.mjs';

const normalize = value => String(value ?? '').normalize('NFKC').trim();
function planShape(plan, catalog) {
  const sort = !plan?.sort || ['recent', 'relevance'].includes(plan.sort)
    ? { field: fieldsWithRole(catalog, 'date')[0], direction: 'desc' } : plan.sort;
  const filters = (plan?.filters ?? []).map(filter => JSON.stringify([
    filter.source ?? null, filter.field, filter.op, (filter.values ?? []).map(normalize).sort(),
  ])).sort();
  return JSON.stringify([filters, plan?.limit ?? 5, [sort.field, sort.direction],
    normalize(plan?.semanticQuery), plan?.causeCategory ?? null, plan?.breakdown ?? null,
    plan?.excludeShown === true || plan?.diagnostics?.excludeShown === true]);
}

export function checkSyntheticFollowUp({ question, live, records, catalog, causeById }) {
  const base = { supported: true, planOk: null, shownOk: null, ok: false, reason: null,
    expectedIds: [], shown: (live?.shown ?? []).map(bareId), chosenAction: live?.followUpAction ?? null };
  if (question.seed?.firstTurnMismatch) return { ...base, supported: false, ok: null, reason: 'first_turn_mismatch' };
  if (question.action === 'count') {
    const ok = live?.outcome === 'count' && live.resultCount === question.expected.matchedCount;
    return { ...base, ok, reason: ok ? null : 'count_mismatch' };
  }
  const planOk = Boolean(live?.plan && isFilterOnlyPlan(live.plan) && planShape(live.plan, catalog) === planShape(question.expected.plan, catalog));
  if (!planOk) return { ...base, planOk, reason: 'follow_up_plan_mismatch' };
  const check = checkFilterAnswer({ plan: live.plan, shown: live.shown, records, catalog, causeById });
  const shownOk = check.supported ? check.ok && ['answer', 'no_result', 'no_other'].includes(live.outcome) : null;
  return { ...base, supported: check.supported, planOk, shownOk, ok: check.supported ? shownOk : null,
    expectedIds: check.expectedIds, reason: !check.supported ? 'filter_unsupported' : shownOk ? null : 'filter_mismatch' };
}
