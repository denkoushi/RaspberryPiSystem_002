import { normalizeMachineName } from '../../productionSchedule/machineName';
import { mergeVisibleResourceOrder } from '../mergeVisibleResourceOrder';

import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardBar } from '@raspi-system/shared-types';

export function forwardQueueWindow(layout: GanttLayout, hovered: GanttBar) {
  const scheduled = layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars))
    .filter((bar) => bar.resource === hovered.resource && !bar.item.isCompleted && bar.start != null)
    .sort((a, b) => a.start! - b.start!);
  const saved = layout.forwardQueue?.filter((bar) => bar.resource === hovered.resource && !bar.item.isCompleted);
  const byId = new Map(saved?.map((bar) => [bar.item.itemId, bar]));
  const queue = saved ? mergeVisibleResourceOrder(saved.map((bar) => bar.item.itemId), scheduled.map((bar) => bar.item.itemId))
    .map((id) => byId.get(id)!) : scheduled;
  const index = queue.findIndex((bar) => bar.item.itemId === hovered.item.itemId);
  if (index < 0) return [];
  return queue.map((bar, i) => ({ bar, position: i + 1 }));
}

export function forwardItemDetails(item: GrindingPlanningBoardBar): string {
  if (item.kind === 'test') return `${item.minutes}分`;
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

// Due dates are plain YYYY-MM-DD calendar days.
export function forwardDueLabel(due: string | null): string | null {
  const match = due && /^(\d{4})-(\d{2})-(\d{2})$/.exec(due);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `${match[2]}/${match[3]}(${WEEKDAYS[date.getUTCDay()]})`;
}

export function canReorderForwardBars(source: GanttBar, target: GanttBar): boolean {
  return source.item.itemId !== target.item.itemId && source.resource === target.resource &&
    !source.arrivalPending && !target.arrivalPending && !source.item.isCompleted && !target.item.isCompleted &&
    (source.item.kind === 'test' || target.item.kind === 'test' || (source.item.specialDue?.expiresAt ?? null) === (target.item.specialDue?.expiresAt ?? null));
}
