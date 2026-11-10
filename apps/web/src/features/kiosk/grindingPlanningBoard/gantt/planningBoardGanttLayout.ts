import { GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';

import { isVisibleByArrival } from '../../isVisibleByArrival';
import { mergeVisibleResourceOrder } from '../mergeVisibleResourceOrder';
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
export const NO_PREDECESSORS: readonly string[] = [];
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

function requiredMinutesUnknown(item: GrindingPlanningBoardItem): boolean {
  return !item.requiredMinutesKnown || (item.kind === 'piece' ? item.requiredMinutes == null : !item.requiredMinutes);
}

// Sibling pieces are one process; ordinary rows retain their individual chain positions.
function planningBoardProcessGroups<T>(items: readonly T[], itemOf: (value: T) => GrindingPlanningBoardItem): T[][] {
  const groups = new Map<string, T[]>();
  for (const value of items) {
    const item = itemOf(value);
    const key = item.kind === 'piece' && item.parentItemId ? `piece:${item.parentItemId}` : `row:${item.itemId}`;
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return Array.from(groups.values());
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
  arrivalPending?: boolean;
};
export type GanttRow = { key: string; label: string; detail: string; bars: GanttBar[]; flagged: boolean; connectors: { start: number; end: number }[] };
export type GanttGroup = { key: string; label: string; resource: string | null; category?: 'grinding' | 'cutting'; rows: GanttRow[] };
export type GanttLayout = { groups: GanttGroup[]; start: number; end: number; today: number; overlapCount: number; mode?: 'forward' | 'backward'; now?: number; lateCount?: number; completedOnly?: boolean; forwardQueue?: GanttBar[] };
// Shared by the legend and movement-slip lookup: placeholders without a drawn bar are excluded.
export function planningBoardVisibleBars(layout: GanttLayout): GanttBar[] {
  return layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars
    .filter((bar) => layout.mode === 'forward' ? bar.unknown || Boolean(bar.segments?.length) : bar.end != null)));
}

export type GanttLayoutOptions = {
  items: readonly GrindingPlanningBoardItem[];
  allocation: PlanningBoardAllocation;
  view: GrindingPlanningBoardView;
  seibanOrder: readonly string[];
  resources: readonly string[];
  category?: GrindingPlanningBoardCategory;
  resourceCategories?: GrindingPlanningBoardResponse['resourceCategories'];
  runsThroughBreaks?: ReadonlySet<string>;
  dailyHoursByResource: Readonly<Record<string, GrindingPlanningBoardResourceDailyHours>>;
  today: string;
  scale: number;
  mode?: 'forward' | 'backward';
  now?: Date;
  laneOrder?: Record<string, string[]>;
  arrivalFilterEnabled?: boolean;
};

function connectPlanningBoardBars(prev: GanttBar, next: GanttBar, links: { start: number; end: number }[]): boolean {
  if (prev.end == null || next.start == null) return false;
  if (next.start < prev.end - 1e-6) {
    prev.flagged = next.flagged = true;
    const span = { start: Math.max(prev.start!, next.start), end: Math.min(prev.end, next.end!) };
    // Reversed, disjoint processes still violate the chain; flag both bars.
    if (span.end > span.start) { prev.overlaps.push(span); next.overlaps.push(span); }
    return true;
  }
  if (next.start > prev.end) links.push({ start: prev.end, end: next.start });
  return false;
}

export function buildPlanningBoardGanttLayout(options: GanttLayoutOptions): GanttLayout {
  if (options.mode === 'forward') return buildForwardPlanningBoardGanttLayout(options);
  const { items, allocation, view, seibanOrder, resources, dailyHoursByResource, scale } = options;
  const today = dateToDay(options.today);
  const sorted = sortGrindingPlanningBoardItems(items.filter((item) => isVisibleByArrival(item, Boolean(options.arrivalFilterEnabled))), seibanOrder, view, allocation);
  const parts = new Map<string, GanttBar[]>();
  let processCounts: Map<string, number> | undefined;
  const bars = sorted.map((item): GanttBar => {
    const resource = resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定';
    const due = resolveGrindingPlanningBoardDueDate(item, allocation);
    const end = due ? dateToDay(due) + 1 : null;
    const unknown = requiredMinutesUnknown(item);
    const hours = dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS;
    const bar: GanttBar = {
      item, resource, due, end, unknown, partKey: planningBoardPartKey(item),
      // Give the due marker a tiny interval for same-day chain checks; its visual width is fixed.
      start: end == null ? null : unknown ? end - 0.001 : end - item.requiredMinutes! / (hours * 60),
      tone: item.isCompleted ? 'completed' : due && due < options.today ? 'late' : 'planned',
      overlaps: [], flagged: false
    };
    if (item.kind === 'piece') (processCounts ??= new Map()).set(bar.partKey, 0);
    const chain = parts.get(bar.partKey) ?? [];
    chain.push(bar);
    parts.set(bar.partKey, chain);
    return bar;
  });
  let overlapCount = 0;
  const connectors = new Map<string, { start: number; end: number }[]>();
  for (const [key, chain] of parts) {
    chain.sort((a, b) => compareProcessOrder(a.item.processOrder, b.item.processOrder) || (a.item.piecePosition ?? Infinity) - (b.item.piecePosition ?? Infinity) || a.item.itemId.localeCompare(b.item.itemId));
    const links: { start: number; end: number }[] = [];
    const processes = processCounts?.has(key) ? planningBoardProcessGroups(chain, (bar) => bar.item) : undefined;
    if (processes) {
      (processCounts ??= new Map()).set(key, processes.length);
      for (let i = 1; i < processes.length; i++) {
        let overlapping = false;
        for (const prev of processes[i - 1]!) for (const next of processes[i]!) {
          if (connectPlanningBoardBars(prev, next, links)) overlapping = true;
        }
        if (overlapping) overlapCount++;
      }
    } else {
      for (let i = 1; i < chain.length; i++) if (connectPlanningBoardBars(chain[i - 1]!, chain[i]!, links)) overlapCount++;
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
          detail: `${chain[0]!.item.fhincd} · ${processCounts?.get(key) ?? chain.length}工程`, bars: chain,
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
const BREAKS_MINUTES: readonly (readonly [number, number])[] = [[10 * 60, 10 * 60 + 10], [12 * 60 + 10, 12 * 60 + 50], [14 * 60 + 50, 15 * 60]];

/** Working periods of one day as fractions of the day; 24H runs without breaks. */
export function workingPeriods(hours: number, pausesForBreaks = true): { start: number; end: number }[] {
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
  if (!pausesForBreaks) return [{ start: SHIFT_START_MINUTES / 1440, end: periods[periods.length - 1]!.end / 1440 }];
  return periods.map((period) => ({ start: period.start / 1440, end: period.end / 1440 }));
}

/** The working period that contains `time`, or the next one after it. */
function workingPeriodFrom(time: number, hours: number, pausesForBreaks: boolean): { start: number; end: number } {
  const day = Math.floor(time + 1e-10);
  for (const offset of [0, 1]) {
    for (const period of workingPeriods(hours, pausesForBreaks)) {
      const start = day + offset + period.start;
      const end = day + offset + period.end;
      if (time < end - 1e-10) return { start: Math.max(time, start), end };
    }
  }
  return { start: day + 1, end: day + 1 };
}

export function nextWorkingStart(time: number, hours: number, pausesForBreaks: boolean): number {
  return workingPeriodFrom(time, hours, pausesForBreaks).start;
}

export function placeForward(time: number, minutes: number, hours: number, pausesForBreaks: boolean) {
  const start = nextWorkingStart(time, hours, pausesForBreaks);
  let cursor = start;
  let remaining = minutes / 1440;
  const segments: { start: number; end: number }[] = [];
  while (remaining > 1e-10) {
    const period = workingPeriodFrom(cursor, hours, pausesForBreaks);
    const take = Math.min(remaining, period.end - period.start);
    segments.push({ start: period.start, end: period.start + take });
    cursor = period.start + take;
    remaining -= take;
  }
  return { start, end: cursor, segments };
}

export function forwardPlanningBoardPredecessors(items: readonly GrindingPlanningBoardItem[]) {
  const parts = new Map<string, GrindingPlanningBoardItem[]>();
  let processCounts: Map<string, number> | undefined;
  for (const item of items) {
    const key = planningBoardPartKey(item);
    if (item.kind === 'piece') (processCounts ??= new Map()).set(key, 0);
    const chain = parts.get(key);
    if (chain) chain.push(item);
    else parts.set(key, [item]);
  }
  const predecessors = new Map<string, string[]>();
  for (const [key, chain] of parts) {
    chain.sort((a, b) => compareProcessOrder(a.processOrder, b.processOrder) || (a.piecePosition ?? Infinity) - (b.piecePosition ?? Infinity) || a.itemId.localeCompare(b.itemId));
    const processes = processCounts?.has(key) ? planningBoardProcessGroups(chain, (item) => item) : undefined;
    if (processes) {
      (processCounts ??= new Map()).set(key, processes.length);
      for (let i = 1; i < processes.length; i++) {
        const previous: string[] = [];
        for (const item of processes[i - 1]!) previous.push(item.itemId);
        for (const item of processes[i]!) predecessors.set(item.itemId, previous);
      }
    } else {
      for (let i = 1; i < chain.length; i++) predecessors.set(chain[i]!.itemId, [chain[i - 1]!.itemId]);
    }
  }
  return { parts, predecessors, processCounts };
}

export function buildForwardPlanningBoardGanttLayout(options: GanttLayoutOptions): GanttLayout {
  const { allocation, view, seibanOrder, resources, dailyHoursByResource, scale } = options;
  const now = jstDay(options.now ?? new Date());
  const today = Math.floor(now);
  const sorted = sortGrindingPlanningBoardItems(options.items.filter((item) => !item.isCompleted), seibanOrder, 'resource', allocation);
  const schedulingItems = sorted.filter((item) => isVisibleByArrival(item, Boolean(options.arrivalFilterEnabled)));
  const { parts, predecessors, processCounts } = forwardPlanningBoardPredecessors(schedulingItems);
  const allLanes = new Map<string, GrindingPlanningBoardItem[]>();
  for (const item of sorted) {
    const resource = resolveGrindingPlanningBoardResource(item, allocation) ?? '未設定';
    const queue = allLanes.get(resource);
    if (queue) queue.push(item);
    else allLanes.set(resource, [item]);
  }
  for (const [resource, queue] of allLanes) {
    const order = options.laneOrder?.[resource];
    if (!order) continue;
    const ranks = new Map(order.map((id, index) => [id, index]));
    queue.sort((a, b) => (ranks.get(a.itemId) ?? Infinity) - (ranks.get(b.itemId) ?? Infinity));
  }
  const lanes = new Map([...allLanes].map(([resource, queue]) => [resource,
    queue.filter((item) => isVisibleByArrival(item, Boolean(options.arrivalFilterEnabled)))]));
  const heads = new Map<string, number>();
  const scheduled = new Map<string, GanttBar>();
  const cursors = new Map<string, number>();
  const isReady = (item: GrindingPlanningBoardItem) => {
    for (const id of predecessors.get(item.itemId) ?? NO_PREDECESSORS) if (!scheduled.has(id)) return false;
    return true;
  };
  const readyAt = (item: GrindingPlanningBoardItem) => {
    let ready = now;
    for (const id of predecessors.get(item.itemId) ?? NO_PREDECESSORS) ready = Math.max(ready, scheduled.get(id)?.end ?? now);
    return ready;
  };
  const place = (item: GrindingPlanningBoardItem, resource: string) => {
    const hours = dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS;
    const pausesForBreaks = !options.runsThroughBreaks?.has(resource);
    const cursor = nextWorkingStart(cursors.get(resource) ?? now, hours, pausesForBreaks);
    const ready = readyAt(item);
    const unknown = requiredMinutesUnknown(item);
    const timing = placeForward(Math.max(cursor, ready), unknown ? 0 : item.requiredMinutes!, hours, pausesForBreaks);
    const due = resolveGrindingPlanningBoardDueDate(item, allocation);
    const lateDays = due ? Math.max(0, Math.ceil(timing.end - dateToDay(due) - 1 - 1e-10)) : 0;
    scheduled.set(item.itemId, { item, resource, due, unknown, ...timing,
      partKey: planningBoardPartKey(item), tone: lateDays > 0 ? 'late' : 'planned', lateDays,
      overlaps: [], flagged: false,
      ...(ready > cursor + 1e-10 ? { waitFrom: cursor, predecessorEnd: ready } : {}) });
    cursors.set(resource, timing.end);
  };
  // Resolve resource heads only after their predecessors. Each pass schedules work, so it is bounded.
  while (scheduled.size < schedulingItems.length) {
    let progressed = false;
    for (const [resource, queue] of lanes) {
      let head = heads.get(resource) ?? 0;
      while (head < queue.length) {
        const item = queue[head]!;
        if (!scheduled.has(item.itemId)) {
          if (!isReady(item)) break;
          const hours = dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS;
          const cursor = nextWorkingStart(cursors.get(resource) ?? now, hours, !options.runsThroughBreaks?.has(resource));
          if (readyAt(item) > cursor + 1e-10) {
            let filler: GrindingPlanningBoardItem | undefined;
            for (let index = head + 1; index < queue.length; index++) {
              const candidate = queue[index]!;
              if (scheduled.has(candidate.itemId)) continue;
              if (isReady(candidate) && readyAt(candidate) <= cursor + 1e-10) {
                filler = candidate;
                break;
              }
            }
            if (filler) {
              place(filler, resource); progressed = true;
              continue;
            }
          }
          place(item, resource); progressed = true;
        }
        head++;
      }
      heads.set(resource, head);
    }
    if (!progressed) {
      // Conflicting ranks can put a successor ahead of its own predecessor (also across resources).
      // Explicit preview orders retain their slots in a cycle; legacy layouts prefer process precedence.
      let candidate: { resource: string; item: GrindingPlanningBoardItem } | undefined;
      let explicitHead: typeof candidate;
      for (const [resource, queue] of lanes) {
        for (let index = heads.get(resource) ?? 0; index < queue.length; index++) {
          const item = queue[index]!;
          if (scheduled.has(item.itemId)) continue;
          if (options.laneOrder?.[resource]) {
            explicitHead ??= { resource, item };
            break;
          }
          if (isReady(item)) {
            candidate = { resource, item };
            break;
          }
        }
        if (candidate) break;
      }
      candidate ??= explicitHead;
      if (!candidate) break;
      place(candidate.item, candidate.resource);
    }
  }
  const bars = options.laneOrder ? [...scheduled.values()] : schedulingItems.map((item) => scheduled.get(item.itemId)!);
  // Keep pending items in their ranked slots while arrived items follow actual scheduling (including fillers).
  const forwardQueue = options.arrivalFilterEnabled ? [...allLanes].flatMap(([resource, queue]) => {
    const byId = new Map(queue.map((item): [string, GanttBar] => [item.itemId, scheduled.get(item.itemId) ?? {
      item, resource, due: resolveGrindingPlanningBoardDueDate(item, allocation), partKey: planningBoardPartKey(item),
      start: null, end: null, unknown: requiredMinutesUnknown(item),
      tone: 'planned', overlaps: [], flagged: false, arrivalPending: true
    }]));
    const visibleOrder = bars.filter((bar) => bar.resource === resource).sort((a, b) => a.start! - b.start!)
      .map((bar) => bar.item.itemId);
    return mergeVisibleResourceOrder(queue.map((item) => item.itemId), visibleOrder).map((id) => byId.get(id)!);
  }) : undefined;
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
      const chains = [...parts.entries()].map(([key, chain]) => [key, chain.filter((item) => isVisibleByArrival(item, Boolean(options.arrivalFilterEnabled)))] as const)
        .filter(([, chain]) => chain[0]?.fseiban === seiban);
      return chains.length ? [{ key: seiban, label: `${seiban} ${chains[0]![1][0]!.machineName ?? ''}`, resource: null,
        rows: chains.map(([key, chain]) => row(key, chain[0]!.fhinmei || chain[0]!.fhincd,
          `${chain[0]!.fhincd} · ${processCounts?.get(key) ?? chain.length}工程`, chain.map((item) => scheduled.get(item.itemId)!))) }] : [];
    });
  return { groups, start: today, today, now, mode: 'forward', overlapCount: 0, forwardQueue,
    end: Math.min(today + 400, Math.max(today + scale + 2, ...bars.map((bar) => Math.ceil(bar.end!) + 1))),
    lateCount: bars.filter((bar) => bar.tone === 'late').length,
    completedOnly: options.items.length > 0 && sorted.length === 0 };
}
