import type { PlanningBoardAllocation } from './types';
import type { GrindingPlanningBoardLoad } from '@raspi-system/shared-types';

export function formatPlanningBoardLoadSummary(requiredMinutes: number | null | undefined, unknownCount: number): string {
  const known = `${requiredMinutes ?? 0}分`;
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
