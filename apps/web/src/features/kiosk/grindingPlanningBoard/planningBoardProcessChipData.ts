import { buildLeaderBoardPartResourceProcessKey } from '../leaderOrderBoard/buildLeaderBoardPartResourceProcessKey';

import { planningBoardPartKey } from './gantt/planningBoardGanttLayout';

import type { PlanningBoardPlacementByPart, PlanningBoardProcessChipsByPart } from './planningBoardProcessChips';
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

/** Merges every row's shelves per part, because the gantt shows one strip per part and placements are recorded per order number. */
export function buildPlanningBoardPlacementByPart(items: readonly GrindingPlanningBoardItem[]): PlanningBoardPlacementByPart {
  const shelvesByPart = new Map<string, Map<string, NonNullable<GrindingPlanningBoardItem['placement']>['shelves'][number]>>();
  for (const item of items) {
    if (!item.placement?.shelves.length) continue;
    const key = planningBoardPartKey(item);
    const shelves = shelvesByPart.get(key) ?? new Map();
    for (const shelf of item.placement.shelves) {
      const current = shelves.get(shelf.shelfCodeRaw);
      if (!current || current.placedAt < shelf.placedAt) shelves.set(shelf.shelfCodeRaw, shelf);
    }
    shelvesByPart.set(key, shelves);
  }
  return new Map([...shelvesByPart].map(([key, shelves]) => [key,
    { shelves: [...shelves.values()].sort((a, b) => b.placedAt.localeCompare(a.placedAt)) }]));
}
