import { GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';

import {
  compareProcessOrder,
  sortPlanningBoardResources,
  resolveGrindingPlanningBoardDueDate,
  resolveGrindingPlanningBoardResource,
  sortGrindingPlanningBoardItems
} from '../sortGrindingPlanningBoardItems';

import type { PlanningBoardAllocation } from '../types';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardResponse, GrindingPlanningBoardItem, GrindingPlanningBoardResourceDailyHours, GrindingPlanningBoardView } from '@raspi-system/shared-types';

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
  segments?: { start: number; end: number }[];
  waitFrom?: number;
  predecessorEnd?: number;
  lateDays?: number;
};
export type GanttRow = { key: string; label: string; detail: string; bars: GanttBar[]; flagged: boolean; connectors: { start: number; end: number }[] };
export type GanttGroup = { key: string; label: string; resource: string | null; category?: 'grinding' | 'cutting'; rows: GanttRow[] };
export type GanttLayout = { groups: GanttGroup[]; start: number; end: number; today: number; overlapCount: number; mode?: 'forward' | 'backward'; now?: number; lateCount?: number; completedOnly?: boolean };
export type GanttLayoutOptions = {
  items: readonly GrindingPlanningBoardItem[];
  allocation: PlanningBoardAllocation;
  view: GrindingPlanningBoardView;
  seibanOrder: readonly string[];
  resources: readonly string[];
  category?: GrindingPlanningBoardCategory;
  resourceCategories?: GrindingPlanningBoardResponse['resourceCategories'];
  dailyHoursByResource: Readonly<Record<string, GrindingPlanningBoardResourceDailyHours>>;
  today: string;
  scale: number;
  mode?: 'forward' | 'backward';
  now?: Date;
};

export function buildPlanningBoardGanttLayout(options: GanttLayoutOptions): GanttLayout {
  if (options.mode === 'forward') return buildForwardPlanningBoardGanttLayout(options);
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
    for (const resource of sortPlanningBoardResources([...new Set([...resources, ...bars.map((bar) => bar.resource)])], options.category, options.resourceCategories)) {
      const members = bars.filter((bar) => bar.resource === resource);
      groups.push({ key: resource, label: resource, resource,
        category: options.category === 'all' ? options.resourceCategories?.[resource] : undefined,
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

// The axis is a JST wall-clock day number, independent of the browser time zone.
export const jstDay = (now: Date): number => (now.getTime() + 9 * 3_600_000) / DAY_MS;

// 8H/10H count working time only: the shift starts at 8:00 and pauses for these breaks (minutes after midnight).
const SHIFT_START_MINUTES = 8 * 60;
const BREAKS_MINUTES: readonly (readonly [number, number])[] = [[10 * 60 + 10, 10 * 60 + 20], [12 * 60 + 10, 12 * 60 + 50], [14 * 60 + 50, 15 * 60]];

/** Working periods of one day as fractions of the day; 24H runs without breaks. */
export function workingPeriods(hours: number): { start: number; end: number }[] {
  if (hours >= 24) return [{ start: 0, end: 1 }];
  const periods: { start: number; end: number }[] = [];
  let cursor = SHIFT_START_MINUTES;
  let remaining = hours * 60;
  for (const [breakStart, breakEnd] of BREAKS_MINUTES) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Math.max(0, breakStart - cursor));
    if (take > 0) periods.push({ start: cursor, end: cursor + take });
    remaining -= take;
    cursor = Math.max(cursor + take, breakEnd);
  }
  if (remaining > 0) periods.push({ start: cursor, end: cursor + remaining });
  return periods.map((period) => ({ start: period.start / 1440, end: period.end / 1440 }));
}

/** The working period that contains `time`, or the next one after it. */
function workingPeriodFrom(time: number, hours: number): { start: number; end: number } {
  const day = Math.floor(time + 1e-10);
  for (const offset of [0, 1]) {
    for (const period of workingPeriods(hours)) {
      const start = day + offset + period.start;
      const end = day + offset + period.end;
      if (time < end - 1e-10) return { start: Math.max(time, start), end };
    }
  }
  return { start: day + 1, end: day + 1 };
}

function nextWorkingStart(time: number, hours: number): number {
  return workingPeriodFrom(time, hours).start;
}

function placeForward(time: number, minutes: number, hours: number) {
  const start = nextWorkingStart(time, hours);
  let cursor = start;
  let remaining = minutes / 1440;
  const segments: { start: number; end: number }[] = [];
  while (remaining > 1e-10) {
    const period = workingPeriodFrom(cursor, hours);
    const take = Math.min(remaining, period.end - period.start);
    const last = segments[segments.length - 1];
    // A break inside the same day keeps the bar whole (the break is drawn over it); only a new day splits it.
    if (last && Math.floor(last.start + 1e-10) === Math.floor(period.start + 1e-10)) last.end = period.start + take;
    else segments.push({ start: period.start, end: period.start + take });
    cursor = period.start + take;
    remaining -= take;
  }
  return { start, end: cursor, segments };
}

export function buildForwardPlanningBoardGanttLayout(options: GanttLayoutOptions): GanttLayout {
  const { allocation, view, seibanOrder, resources, dailyHoursByResource, scale } = options;
  const now = jstDay(options.now ?? new Date());
  const today = Math.floor(now);
  const sorted = sortGrindingPlanningBoardItems(options.items.filter((item) => !item.isCompleted), seibanOrder, 'resource', allocation);
  const parts = new Map<string, GrindingPlanningBoardItem[]>();
  for (const item of sorted) {
    const key = planningBoardPartKey(item);
    parts.set(key, [...(parts.get(key) ?? []), item]);
  }
  const predecessors = new Map<string, string>();
  for (const chain of parts.values()) {
    chain.sort((a, b) => compareProcessOrder(a.processOrder, b.processOrder) || a.itemId.localeCompare(b.itemId));
    for (let i = 1; i < chain.length; i++) predecessors.set(chain[i]!.itemId, chain[i - 1]!.itemId);
  }
  const lanes = new Map<string, GrindingPlanningBoardItem[]>();
  for (const item of sorted) {
    const resource = resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定';
    lanes.set(resource, [...(lanes.get(resource) ?? []), item]);
  }
  const scheduled = new Map<string, GanttBar>();
  const cursors = new Map<string, number>();
  const place = (item: GrindingPlanningBoardItem, resource: string) => {
    const hours = dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS;
    const cursor = nextWorkingStart(cursors.get(resource) ?? now, hours);
    const predecessor = scheduled.get(predecessors.get(item.itemId) ?? '');
    const ready = predecessor?.end ?? now;
    const unknown = !item.requiredMinutesKnown || !item.requiredMinutes;
    const timing = placeForward(Math.max(cursor, ready), unknown ? 0 : item.requiredMinutes!, hours);
    const due = resolveGrindingPlanningBoardDueDate(item, allocation);
    const lateDays = due ? Math.max(0, Math.ceil(timing.end - dateToDay(due) - 1 - 1e-10)) : 0;
    scheduled.set(item.itemId, { item, resource, due, unknown, ...timing,
      partKey: planningBoardPartKey(item), tone: lateDays > 0 ? 'late' : 'planned', lateDays,
      overlaps: [], flagged: false,
      ...(ready > cursor + 1e-10 ? { waitFrom: cursor, predecessorEnd: ready } : {}) });
    cursors.set(resource, timing.end);
  };
  // Resolve resource heads only after their predecessors. Each pass removes work, so it is bounded.
  while (scheduled.size < sorted.length) {
    let progressed = false;
    for (const [resource, queue] of lanes) {
      while (queue.length) {
        const item = queue[0]!;
        const predecessor = predecessors.get(item.itemId);
        if (predecessor && !scheduled.has(predecessor)) break;
        place(item, resource); queue.shift(); progressed = true;
      }
    }
    if (!progressed) {
      // Conflicting ranks can put a successor ahead of its own predecessor (also across resources).
      // Prefer process precedence in that cycle, keeping the remaining ranked queue intact.
      const candidate = [...lanes.entries()].flatMap(([resource, queue]) => queue.map((item) => ({ resource, item })))
        .find(({ item }) => !predecessors.has(item.itemId) || scheduled.has(predecessors.get(item.itemId)!));
      if (!candidate) break;
      place(candidate.item, candidate.resource);
      const queue = lanes.get(candidate.resource)!;
      queue.splice(queue.indexOf(candidate.item), 1);
    }
  }
  const bars = sorted.map((item) => scheduled.get(item.itemId)!);
  const row = (key: string, label: string, detail: string, members: GanttBar[]): GanttRow => ({
    key, label, detail, bars: members, flagged: false,
    connectors: members.filter((bar) => bar.waitFrom != null).map((bar) => ({ start: bar.waitFrom!, end: bar.start! }))
  });
  const groups: GanttGroup[] = view === 'resource'
    ? sortPlanningBoardResources([...new Set([...resources, ...bars.map((bar) => bar.resource)])], options.category, options.resourceCategories).map((resource) => ({
      key: resource, label: resource, resource,
        category: options.category === 'all' ? options.resourceCategories?.[resource] : undefined,
      rows: [row(resource, resource, '', bars.filter((bar) => bar.resource === resource))]
    }))
    : [...new Set([...seibanOrder, ...sorted.map((item) => item.fseiban)])].flatMap((seiban) => {
      const chains = [...parts.entries()].filter(([, chain]) => chain[0]?.fseiban === seiban);
      return chains.length ? [{ key: seiban, label: `${seiban} ${chains[0]![1][0]!.machineName ?? ''}`, resource: null,
        rows: chains.map(([key, chain]) => row(key, chain[0]!.fhinmei || chain[0]!.fhincd,
          `${chain[0]!.fhincd} · ${chain.length}工程`, chain.map((item) => scheduled.get(item.itemId)!))) }] : [];
    });
  return { groups, start: today, today, now, mode: 'forward', overlapCount: 0,
    end: Math.min(today + 400, Math.max(today + scale + 2, ...bars.map((bar) => Math.ceil(bar.end!) + 1))),
    lateCount: bars.filter((bar) => bar.tone === 'late').length,
    completedOnly: options.items.length > 0 && sorted.length === 0 };
}
