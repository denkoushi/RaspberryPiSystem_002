import { normalizeMachineName } from '../../productionSchedule/machineName';

import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export function forwardQueueWindow(layout: GanttLayout, hovered: GanttBar) {
  const queue = layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars))
    .filter((bar) => bar.resource === hovered.resource && !bar.item.isCompleted && bar.start != null)
    .sort((a, b) => a.start! - b.start!);
  const index = queue.findIndex((bar) => bar.item.itemId === hovered.item.itemId);
  if (index < 0) return [];
  const from = Math.max(0, index - 2);
  return queue.slice(from, from + 8).map((bar, i) => ({ bar, position: from + i + 1 }));
}

export function forwardItemDetails(item: GrindingPlanningBoardItem, includeMachine = false): string {
  return [item.fseiban, item.fhincd, item.plannedQuantity == null ? null : `${item.plannedQuantity}個`, includeMachine ? normalizeMachineName(item.machineName) : null]
    .filter((part) => part != null && part.trim() !== '').join(' · ');
}

export function canReorderForwardBars(source: GanttBar, target: GanttBar): boolean {
  return source.item.itemId !== target.item.itemId && source.resource === target.resource &&
    !source.item.isCompleted && !target.item.isCompleted &&
    (source.item.specialDue?.expiresAt ?? null) === (target.item.specialDue?.expiresAt ?? null);
}
