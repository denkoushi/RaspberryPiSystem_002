import type { GrindingPlanningBoardResourceCapacityResponse } from '@raspi-system/shared-types';

export function defaultUnitSplitEnabled(resourceCd: string): boolean {
  return resourceCd === '021' || resourceCd === '022';
}
export function isUnitSplitEnabled(resourceCd: string | null, settings?: GrindingPlanningBoardResourceCapacityResponse): boolean {
  if (resourceCd == null) return false;
  const flags = settings?.unitSplitEnabledByResource;
  const stored = flags && Object.hasOwn(flags, resourceCd) ? flags[resourceCd] : undefined;
  return typeof stored === 'boolean' ? stored : defaultUnitSplitEnabled(resourceCd);
}
