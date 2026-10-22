import { buildLeaderBoardPartResourceProcessKey } from '../leaderOrderBoard/buildLeaderBoardPartResourceProcessKey';

import { planningBoardPartKey } from './gantt/planningBoardGanttLayout';

import type { PlanningBoardProcessChipsByPart } from './planningBoardProcessChips';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardProcessChipsRequest, GrindingPlanningBoardProcessChipsResponse } from '@raspi-system/shared-types';

const serverPartKey = (part: GrindingPlanningBoardProcessChipsRequest['parts'][number]) =>
  buildLeaderBoardPartResourceProcessKey({ seibanJoinKey: part.fseiban, productNo: part.productNo, fhincd: part.fhincd });

export function collectPlanningBoardProcessChipParts(items: readonly GrindingPlanningBoardItem[]): GrindingPlanningBoardProcessChipsRequest['parts'] {
  const parts = new Map<string, GrindingPlanningBoardProcessChipsRequest['parts'][number]>();
  for (const item of items) {
    const part = { fseiban: item.fseiban.trim(), productNo: item.productNo.trim(), fhincd: item.fhincd.trim() };
    if (!part.fseiban || !part.fhincd) continue;
    parts.set(serverPartKey(part), part);
  }
  return [...parts.keys()].sort().map((key) => parts.get(key)!);
}

export function buildPlanningBoardProcessChipsByPart(
  items: readonly GrindingPlanningBoardItem[],
  chipsByPartKey: GrindingPlanningBoardProcessChipsResponse['chipsByPartKey'] | undefined
): PlanningBoardProcessChipsByPart {
  const result = new Map<string, GrindingPlanningBoardProcessChipsResponse['chipsByPartKey'][string]>();
  if (!chipsByPartKey) return result;
  for (const item of items) {
    const key = planningBoardPartKey(item);
    const chips = chipsByPartKey[serverPartKey(item)];
    if (!result.has(key) && chips?.length) result.set(key, chips);
  }
  return result;
}
