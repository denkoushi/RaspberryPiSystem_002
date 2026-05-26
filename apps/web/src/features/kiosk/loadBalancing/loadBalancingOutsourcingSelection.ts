import type { ProductionScheduleLoadBalancingOverviewResource } from '../../../api/client';

export function listOverResourceCds(resources: ProductionScheduleLoadBalancingOverviewResource[]): string[] {
  return resources
    .filter((resource) => resource.overMinutes > 0)
    .sort((a, b) => b.overMinutes - a.overMinutes || a.resourceCd.localeCompare(b.resourceCd))
    .map((resource) => resource.resourceCd);
}

export function toggleSelectedResourceCd(selected: string[], resourceCd: string): string[] {
  const normalized = resourceCd.trim().toUpperCase();
  if (selected.includes(normalized)) {
    return selected.filter((cd) => cd !== normalized);
  }
  return [...selected, normalized];
}

export function toggleSelectedRowId(selected: string[], rowId: string): string[] {
  const normalized = rowId.trim();
  if (selected.includes(normalized)) {
    return selected.filter((id) => id !== normalized);
  }
  return [...selected, normalized];
}
