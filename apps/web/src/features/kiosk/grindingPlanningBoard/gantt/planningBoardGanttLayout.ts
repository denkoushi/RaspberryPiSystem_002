import { GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';

import {
  compareProcessOrder,
  resolveGrindingPlanningBoardDueDate,
  resolveGrindingPlanningBoardResource,
  sortGrindingPlanningBoardItems
} from '../sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from '../types';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceDailyHours, GrindingPlanningBoardView } from '@raspi-system/shared-types';

const DAY_MS = 86_400_000;
export const dateToDay = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
};
export const dayToDate = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const dayLabel = (day: number): string => {
  const date = new Date(day * DAY_MS);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
};

// Same identity as the projection: only unassigned seibans split by productNo.
export function planningBoardPartKey(item: GrindingPlanningBoardItem): string {
  const parts = [item.fseiban.trim(), item.fhincd.trim()];
  if (item.fseiban.trim() === '********') parts.push(item.productNo.trim());
  return parts.join('\0');
}

export type GanttBar = {
  item: GrindingPlanningBoardItem;
  partKey: string;
  resource: string;
  due: string | null;
  start: number | null;
  end: number | null;
  unknown: boolean;
  tone: 'planned' | 'late' | 'completed';
  overlaps: { start: number; end: number }[];
  flagged: boolean;
};
export type GanttRow = { key: string; label: string; detail: string; bars: GanttBar[]; flagged: boolean; connectors: { start: number; end: number }[] };
export type GanttGroup = { key: string; label: string; resource: string | null; rows: GanttRow[] };
export type GanttLayout = { groups: GanttGroup[]; start: number; end: number; today: number; overlapCount: number };
export type GanttLayoutOptions = {
  items: readonly GrindingPlanningBoardItem[];
  allocation: PlanningBoardAllocation;
  view: GrindingPlanningBoardView;
  seibanOrder: readonly string[];
  resources: readonly string[];
  dailyHoursByResource: Readonly<Record<string, GrindingPlanningBoardResourceDailyHours>>;
  today: string;
  scale: number;
};

export function buildPlanningBoardGanttLayout(options: GanttLayoutOptions): GanttLayout {
  const { items, allocation, view, seibanOrder, resources, dailyHoursByResource, scale } = options;
  const today = dateToDay(options.today);
  const sorted = sortGrindingPlanningBoardItems(items, seibanOrder, view, allocation);
  const parts = new Map<string, GanttBar[]>();
  const bars = sorted.map((item): GanttBar => {
    const resource = resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定';
    const due = resolveGrindingPlanningBoardDueDate(item, allocation);
    const end = due ? dateToDay(due) + 1 : null;
    const unknown = !item.requiredMinutesKnown || !item.requiredMinutes;
    const hours = dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS;
    const bar: GanttBar = {
      item, resource, due, end, unknown, partKey: planningBoardPartKey(item),
      // Give the due marker a tiny interval for same-day chain checks; its visual width is fixed.
      start: end == null ? null : unknown ? end - 0.001 : end - item.requiredMinutes! / (hours * 60),
      tone: item.isCompleted ? 'completed' : due && due < options.today ? 'late' : 'planned',
      overlaps: [], flagged: false
    };
    const chain = parts.get(bar.partKey) ?? [];
    chain.push(bar);
    parts.set(bar.partKey, chain);
    return bar;
  });
  let overlapCount = 0;
  const connectors = new Map<string, { start: number; end: number }[]>();
  for (const [key, chain] of parts) {
    chain.sort((a, b) => compareProcessOrder(a.item.processOrder, b.item.processOrder) || a.item.itemId.localeCompare(b.item.itemId));
    const links: { start: number; end: number }[] = [];
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1]!; const next = chain[i]!;
      if (prev.end == null || next.start == null) continue;
      if (next.start < prev.end - 1e-6) {
        overlapCount++;
        prev.flagged = next.flagged = true;
        const span = { start: Math.max(prev.start!, next.start), end: Math.min(prev.end, next.end!) };
        // Reversed, disjoint processes still violate the chain; flag both bars.
        if (span.end > span.start) { prev.overlaps.push(span); next.overlaps.push(span); }
      } else if (next.start > prev.end) links.push({ start: prev.end, end: next.start });
    }
    connectors.set(key, links);
  }
  const groups: GanttGroup[] = [];
  if (view === 'seiban') {
    for (const seiban of [...new Set([...seibanOrder, ...sorted.map((item) => item.fseiban)])]) {
      const chains = [...parts.entries()].filter(([, chain]) => chain[0]?.item.fseiban === seiban);
      if (!chains.length) continue;
      groups.push({ key: seiban, label: `${seiban} ${chains[0]![1][0]!.item.machineName ?? ''}`, resource: null,
        rows: chains.map(([key, chain]) => ({ key, label: chain[0]!.item.fhinmei || chain[0]!.item.fhincd,
          detail: `${chain[0]!.item.fhincd} · ${chain.length}工程`, bars: chain,
          flagged: chain.some((bar) => bar.flagged), connectors: connectors.get(key) ?? [] })) });
    }
  } else {
    for (const resource of [...new Set([...resources, ...bars.map((bar) => bar.resource)])]) {
      const members = bars.filter((bar) => bar.resource === resource);
      groups.push({ key: resource, label: resource, resource,
        rows: members.map((bar) => ({ key: bar.item.itemId, label: bar.item.fhinmei || bar.item.fhincd,
          detail: `${bar.item.fseiban} · ${bar.item.processOrder}`, bars: [bar], flagged: bar.flagged, connectors: [] })) });
    }
  }
  let start = today - 4; let end = today + scale + 2;
  for (const bar of bars) {
    if (bar.start != null) start = Math.min(start, Math.floor(bar.start) - 1);
    if (bar.end != null) end = Math.max(end, bar.end + 1);
  }
  // Bound DOM and scroll width while keeping today and the chosen scale in range.
  start = Math.max(start, today - (400 - scale - 3));
  end = Math.min(end, start + 400);
  return { groups, start, end, today, overlapCount };
}

export function shiftedDueDate(due: string, delta: number, today: string): string {
  const original = dateToDay(due);
  const shifted = original + delta;
  // An already overdue bar cannot jump forward merely because it was dragged left.
  return dayToDate(delta < 0 ? Math.max(shifted, Math.min(original, dateToDay(today))) : shifted);
}
