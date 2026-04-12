import type { PartPlacementSearchHitDto } from './types';

export function partSearchHitIdentity(hit: PartPlacementSearchHitDto): string {
  if (hit.matchSource === 'current' && hit.branchStateId) return `current:${hit.branchStateId}`;
  if (hit.csvDashboardRowId) return `schedule:${hit.csvDashboardRowId}`;
  return `${hit.matchSource}:${hit.displayName}:${hit.productNo ?? ''}`;
}
