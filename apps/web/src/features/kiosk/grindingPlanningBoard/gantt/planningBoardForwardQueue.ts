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

export function formatForwardQueueTime(day: number, today: number): string {
  // Layout days already encode JST wall time; applying the timezone again would add nine hours.
  const date = new Date(Math.round(day * 1440) * 60_000);
  const prefix = Math.floor(date.getTime() / 86_400_000) === today ? '' : `${date.getUTCMonth() + 1}/${date.getUTCDate()} `;
  return `${prefix}${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function forwardItemDetails(item: GrindingPlanningBoardItem, includeMachine = false): string {
  return [item.fhincd, item.plannedQuantity == null ? null : `${item.plannedQuantity}個`, includeMachine ? item.machineName : null]
    .filter((part) => part != null && part.trim() !== '').join(' · ');
}

export function canReorderForwardBars(source: GanttBar, target: GanttBar): boolean {
  return source.item.itemId !== target.item.itemId && source.resource === target.resource &&
    !source.item.isCompleted && !target.item.isCompleted &&
    (source.item.specialDue?.expiresAt ?? null) === (target.item.specialDue?.expiresAt ?? null);
}
