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

export function forwardItemDetails(item: GrindingPlanningBoardItem): string {
  return [item.fseiban, item.fhincd, item.plannedQuantity == null ? null : `${item.plannedQuantity}個`, normalizeMachineName(item.machineName)]
    .filter((part) => part != null && part.trim() !== '').join(' · ');
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const pad2 = (value: number) => String(value).padStart(2, '0');
// Bar days are JST wall-clock days; a bar split by breaks starts at its first segment.
export function forwardStartLabel(bar: GanttBar): string | null {
  const start = bar.segments?.[0]?.start ?? bar.start;
  if (start == null) return null;
  const date = new Date(Math.round(start * 1440) * 60_000);
  return `${pad2(date.getUTCMonth() + 1)}/${pad2(date.getUTCDate())}(${WEEKDAYS[date.getUTCDay()]}) ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
}

export function canReorderForwardBars(source: GanttBar, target: GanttBar): boolean {
  return source.item.itemId !== target.item.itemId && source.resource === target.resource &&
    !source.item.isCompleted && !target.item.isCompleted &&
    (source.item.specialDue?.expiresAt ?? null) === (target.item.specialDue?.expiresAt ?? null);
}
