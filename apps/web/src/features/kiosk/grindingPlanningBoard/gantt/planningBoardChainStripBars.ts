import { compareProcessOrder, resolveGrindingPlanningBoardResource } from '../sortGrindingPlanningBoardItems';

import { planningBoardPartKey, type NormalGanttBar } from './planningBoardGanttLayout';

import type { PlanningBoardAllocation } from '../types';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export type ChainStripBar = Pick<NormalGanttBar, 'item' | 'resource'>;

export function compareChainStripBars(a: ChainStripBar, b: ChainStripBar): number {
  return compareProcessOrder(a.item.processOrder, b.item.processOrder) || (a.item.piecePosition ?? Infinity) - (b.item.piecePosition ?? Infinity) || a.item.itemId.localeCompare(b.item.itemId);
}

/** 帯「工程のつながり」用。ガントの棒に、同じ部品の完了項目(ガントには出ない)を混ぜて並べる。 */
export function planningBoardChainStripBars(chain: readonly ChainStripBar[], items: readonly GrindingPlanningBoardItem[] | undefined, partKey: string, allocation: PlanningBoardAllocation): ChainStripBar[] {
  const existingIds = new Set(chain.map(({ item }) => item.itemId));
  const completed = (items ?? []).filter((item) => item.isCompleted && planningBoardPartKey(item) === partKey && !existingIds.has(item.itemId))
    .map((item) => ({ item, resource: resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定' }));
  return [...chain, ...completed].filter(({ item }) => !item.standardHoursMissing).sort(compareChainStripBars);
}
