import { normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { listLoadBalancingTransferRules } from './load-balancing-settings.service.js';
import { getProductionScheduleLoadBalancingOverview } from './load-balancing-overview.service.js';
import { listMonthlyLoadRowCandidates } from './monthly-load-query.service.js';
import { computeLoadBalancingSuggestions } from './reallocation-suggestion.engine.js';

export async function suggestProductionScheduleLoadBalancing(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
  maxSuggestions: number;
  overResourceCds?: string[];
}): Promise<{
  siteKey: string;
  yearMonth: string;
  suggestions: ReturnType<typeof computeLoadBalancingSuggestions>;
}> {
  const [overview, rows, rules] = await Promise.all([
    getProductionScheduleLoadBalancingOverview(params),
    listMonthlyLoadRowCandidates(params),
    listLoadBalancingTransferRules(params.siteKey)
  ]);

  const classMap = new Map(
    overview.resources
      .filter((item) => item.classCode !== null)
      .map((item) => [item.resourceCd, item.classCode as string])
  );
  const filter =
    params.overResourceCds && params.overResourceCds.length > 0
      ? new Set(
          params.overResourceCds
            .map((cd) => normalizeProductionScheduleResourceCd(cd))
            .filter((cd) => cd.length > 0)
        )
      : undefined;

  const suggestions = computeLoadBalancingSuggestions({
    overviewResources: overview.resources,
    rows,
    classes: classMap,
    rules: rules.items,
    maxSuggestions: params.maxSuggestions,
    overResourceFilter: filter
  });

  return {
    siteKey: overview.siteKey,
    yearMonth: overview.yearMonth,
    suggestions
  };
}
