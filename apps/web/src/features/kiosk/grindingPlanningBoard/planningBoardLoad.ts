import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardLoad } from '@raspi-system/shared-types';

export function formatPlanningBoardItemMinutes(item: Pick<GrindingPlanningBoardItem, 'kind' | 'requiredMinutes'>): string {
  const minutes = item.requiredMinutes;
  return `${item.kind === 'piece' && minutes != null ? Number(minutes.toFixed(1)) : minutes}分`;
}

export function formatPlanningBoardLoadSummary(requiredMinutes: number | null | undefined, unknownCount: number): string {
  const minutes = requiredMinutes ?? 0;
  const known = `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)}分`;
  return unknownCount > 0 ? `${known} + 不明${unknownCount}件` : known;
}

export function formatPlanningBoardResourceLoad(
  summary: GrindingPlanningBoardLoad | undefined,
  allocation: PlanningBoardAllocation
): string {
  if (!summary) return formatPlanningBoardLoadSummary(0, 0);
  return formatPlanningBoardLoadSummary(
    allocation === 'original' ? summary.originalRequiredMinutes : summary.alternateRequiredMinutes,
    allocation === 'original' ? summary.originalUnknownItemCount : summary.alternateUnknownItemCount
  );
}
