import {
  listLoadBalancingCapacityBase,
  listLoadBalancingClasses,
  listLoadBalancingMonthlyCapacity
} from './load-balancing-settings.service.js';
import { aggregateMonthlyLoadByResource } from './monthly-load-query.service.js';
import type { LoadBalancingOverviewResult } from './types.js';

export async function getProductionScheduleLoadBalancingOverview(params: {
  siteKey: string;
  deviceScopeKey: string;
  yearMonth: string;
}): Promise<LoadBalancingOverviewResult> {
  const ym = params.yearMonth.trim();
  const [aggregates, baseCap, monthlyCap, classes] = await Promise.all([
    aggregateMonthlyLoadByResource({
      siteKey: params.siteKey,
      deviceScopeKey: params.deviceScopeKey,
      yearMonth: ym
    }),
    listLoadBalancingCapacityBase(params.siteKey),
    listLoadBalancingMonthlyCapacity({ siteKeyInput: params.siteKey, yearMonth: ym }),
    listLoadBalancingClasses(params.siteKey)
  ]);

  const baseMap = new Map(baseCap.items.map((item) => [item.resourceCd, item.baseAvailableMinutes]));
  const monthlyMap = new Map(monthlyCap.items.map((item) => [item.resourceCd, item.availableMinutes]));
  const classMap = new Map(classes.items.map((item) => [item.resourceCd, item.classCode]));
  const aggregateMap = new Map(aggregates.map((item) => [item.resourceCd, item.requiredMinutes]));

  const resourceSet = new Set<string>();
  aggregates.forEach((item) => resourceSet.add(item.resourceCd));
  baseMap.forEach((_value, key) => resourceSet.add(key));
  monthlyMap.forEach((_value, key) => resourceSet.add(key));
  classMap.forEach((_value, key) => resourceSet.add(key));

  const resources = [...resourceSet].sort((a, b) => a.localeCompare(b)).map((resourceCd) => {
    const requiredMinutes = aggregateMap.get(resourceCd) ?? 0;
    let availableMinutes: number | null = null;
    if (monthlyMap.has(resourceCd)) {
      availableMinutes = monthlyMap.get(resourceCd)!;
    } else if (baseMap.has(resourceCd)) {
      availableMinutes = baseMap.get(resourceCd)!;
    }
    const effectiveAvailable = availableMinutes ?? 0;
    const overMinutes = Math.max(0, requiredMinutes - effectiveAvailable);
    return {
      resourceCd,
      requiredMinutes,
      availableMinutes,
      overMinutes,
      classCode: classMap.get(resourceCd) ?? null
    };
  });

  return {
    siteKey: baseCap.siteKey,
    yearMonth: ym,
    resources
  };
}
