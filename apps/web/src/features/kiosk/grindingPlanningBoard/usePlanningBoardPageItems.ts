import { useMemo } from 'react';

import { sortGrindingPlanningBoardItems } from './sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from './types';
import type { PlanningBoardDisplayItem } from './usePlanningBoardWriteQueue';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardItem, GrindingPlanningBoardResponse, GrindingPlanningBoardView } from '@raspi-system/shared-types';

type Options = {
  displayItems: GrindingPlanningBoardItem[];
  registeredFseibans: string[];
  view: GrindingPlanningBoardView;
  allocation: PlanningBoardAllocation;
  data: Pick<GrindingPlanningBoardResponse, 'machineNames'> | undefined;
  activeFseibans: ReadonlySet<string>;
  selectedItemIdsByCategory: Record<string, ReadonlySet<string>>;
  category: GrindingPlanningBoardCategory;
};

export function usePlanningBoardPageItems({
  displayItems, registeredFseibans, view, allocation, data, activeFseibans, selectedItemIdsByCategory, category
}: Options) {
  const itemsBySeiban = useMemo(() => {
    const grouped = new Map<string, GrindingPlanningBoardItem[]>();
    for (const item of displayItems) {
      const group = grouped.get(item.fseiban) ?? [];
      group.push(item);
      grouped.set(item.fseiban, group);
    }
    return grouped;
  }, [displayItems]);
  const sortedItemsBySeiban = useMemo(() => {
    const sorted = new Map<string, GrindingPlanningBoardItem[]>();
    for (const [fseiban, group] of itemsBySeiban) {
      sorted.set(fseiban, sortGrindingPlanningBoardItems(group, registeredFseibans, view, allocation));
    }
    return sorted;
  }, [allocation, itemsBySeiban, registeredFseibans, view]);
  const boardMachineNames = data?.machineNames;
  const machineNames = useMemo(() => {
    // 区分内に工程が無い登録製番も機種名を出せるよう、サーバーが返す全製番分を土台にする。
    const result = new Map<string, string | null>(Object.entries(boardMachineNames ?? {}));
    for (const item of displayItems) if (item.machineName) result.set(item.fseiban, item.machineName);
    return result;
  }, [boardMachineNames, displayItems]);
  const visibleItems = useMemo(
    () => displayItems.filter((item) => activeFseibans.has(item.fseiban)),
    [activeFseibans, displayItems]
  );
  const specialDueCounts = useMemo(() => {
    const counts = { overnight: 0, today: 0 };
    for (const item of visibleItems) {
      const preview = item as PlanningBoardDisplayItem;
      const kind = preview.pendingSpecialDue !== undefined ? preview.pendingSpecialDue : item.specialDue?.kind;
      if (kind) counts[kind] += 1;
    }
    return counts;
  }, [visibleItems]);
  const selectedItemIds = useMemo(
    () => {
      const selectedItemIdsForCategory = selectedItemIdsByCategory[category] ?? new Set<string>();
      return new Set(visibleItems.filter((item) => !item.isCompleted && selectedItemIdsForCategory.has(item.itemId)).map((item) => item.itemId));
    },
    [category, selectedItemIdsByCategory, visibleItems]
  );
  const selectedVisibleItems = useMemo(
    () => visibleItems.filter((item) => !item.isCompleted && selectedItemIds.has(item.itemId)),
    [selectedItemIds, visibleItems]
  );
  return { itemsBySeiban, sortedItemsBySeiban, machineNames, visibleItems, specialDueCounts, selectedItemIds, selectedVisibleItems };
}
