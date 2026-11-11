import { GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS } from '@raspi-system/shared-types';

import { comparePlanningBoardBarOrder, resolveGrindingPlanningBoardDueDate, resolveGrindingPlanningBoardResource, sortGrindingPlanningBoardItems } from '../sortGrindingPlanningBoardItems';

import { NO_PREDECESSORS, forwardPlanningBoardPredecessors, jstDay, nextWorkingStart, placeForward } from './planningBoardGanttLayout';

import type { GanttLayout, GanttLayoutOptions } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardBar } from '@raspi-system/shared-types';


export type PlanningBoardOrderMetrics = { lateCount: number; waitMinutes: number };

export function planningBoardOrderMetrics(layout: GanttLayout): PlanningBoardOrderMetrics {
  const bars = layout.groups.flatMap((group) => group.rows.flatMap((row) => row.bars));
  return { lateCount: bars.filter((bar) => bar.tone === 'late').length,
    waitMinutes: Math.round(bars.reduce((sum, bar) => sum + (bar.start != null && bar.waitFrom != null ? Math.max(0, bar.start - bar.waitFrom) * 1440 : 0), 0)) };
}

export function planningBoardLaneOrder(options: Pick<GanttLayoutOptions, 'items' | 'testBars' | 'seibanOrder' | 'allocation' | 'laneOrder'>): Record<string, string[]> {
  const lanes: Record<string, string[]> = {};
  for (const item of sortGrindingPlanningBoardItems(options.items.filter((item) => !item.isCompleted), options.seibanOrder, 'resource', options.allocation)) {
    const resource = resolveGrindingPlanningBoardResource(item, options.allocation) ?? '未設定';
    (lanes[resource] ??= []).push(item.itemId);
  }
  for (const item of options.testBars ?? []) {
    if (!item.isCompleted && !item.deletedAt) (lanes[item.resourceCd] ??= []).push(item.itemId);
  }
  const byId = new Map<string, GrindingPlanningBoardBar>([...options.items, ...options.testBars ?? []].map((item) => [item.itemId, item]));
  for (const [resource, lane] of Object.entries(lanes)) {
    if (lane.some((id) => byId.get(id)?.kind === 'test')) lane.sort((a, b) => comparePlanningBoardBarOrder(byId.get(a)!, byId.get(b)!));
    const explicit = options.laneOrder?.[resource];
    if (explicit) {
      const ranks = new Map(explicit.map((id, index) => [id, index]));
      lane.sort((a, b) => (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity));
    }
  }
  return lanes;
}

/** Schedule ready work across every lane, leaving pinned slots at their current indices. */
export function planningBoardAutoOrder(options: GanttLayoutOptions, pinnedItemIds: ReadonlySet<string>): Record<string, string[]> {
  const normal = sortGrindingPlanningBoardItems(options.items.filter((item) => !item.isCompleted), options.seibanOrder, 'resource', options.allocation);
  const tests = (options.testBars ?? []).filter((item) => !item.isCompleted && !item.deletedAt);
  const sorted: GrindingPlanningBoardBar[] = [...normal, ...tests];
  pinnedItemIds = new Set([...pinnedItemIds, ...tests.map((item) => item.itemId)]);
  const { predecessors } = forwardPlanningBoardPredecessors(normal);
  const items = new Map(sorted.map((item) => [item.itemId, item]));
  const current = planningBoardLaneOrder(options);
  const ranks = new Map(Object.values(current).flat().map((id, index) => [id, index]));
  const orders: Record<string, string[]> = Object.fromEntries(Object.keys(current).map((resource) => [resource, []]));
  const ends = new Map<string, number>();
  const cursors = new Map<string, number>();
  const now = jstDay(options.now ?? new Date());
  const due = (item: GrindingPlanningBoardBar) => resolveGrindingPlanningBoardDueDate(item, options.allocation) ?? '9999-12-31';
  while (ends.size < sorted.length) {
    let best: { item: GrindingPlanningBoardBar; resource: string; start: number; hours: number; pausesForBreaks: boolean } | undefined;
    for (const [resource, lane] of Object.entries(current)) {
      const head = lane[orders[resource]!.length];
      if (!head) continue;
      const unpinned = lane.filter((id) => !pinnedItemIds.has(id) && !ends.has(id));
      // `sorted` preserves the existing special-due comparator order, even while waiting for predecessors.
      const special = sorted.find((item) => item.kind !== 'test' && item.specialDue && unpinned.includes(item.itemId));
      // An explicit lane order can pin normal work above special work. Keep that pin's slot,
      // but re-sorting saved ranks will move special work ahead of it; round-trip stability excludes this case.
      const candidates = pinnedItemIds.has(head) ? [head] : special ? [special.itemId] : unpinned;
      for (const id of candidates) {
        let ready = now;
        for (const itemId of predecessors.get(id) ?? NO_PREDECESSORS) {
          const end = ends.get(itemId);
          if (end == null) { ready = Infinity; break; }
          ready = Math.max(ready, end);
        }
        if (ready === Infinity) continue;
        const item = items.get(id)!;
        const hours = options.dailyHoursByResource[resource] ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS;
        const pausesForBreaks = !options.runsThroughBreaks?.has(resource);
        const start = nextWorkingStart(Math.max(cursors.get(resource) ?? now, ready), hours, pausesForBreaks);
        if (!best || start < best.start - 1e-10 || (Math.abs(start - best.start) < 1e-10 &&
          (due(item).localeCompare(due(best.item)) || ranks.get(id)! - ranks.get(best.item.itemId)!) < 0)) {
          best = { item, resource, start, hours, pausesForBreaks };
        }
      }
    }
    if (!best) break;
    const timing = placeForward(best.start, best.item.kind === 'test' ? best.item.minutes : best.item.requiredMinutesKnown ? best.item.requiredMinutes ?? 0 : 0, best.hours, best.pausesForBreaks);
    orders[best.resource]!.push(best.item.itemId);
    ends.set(best.item.itemId, timing.end);
    cursors.set(best.resource, timing.end);
  }
  // Conflicting pins/precedence can deadlock. Fill the remaining slots in current order, retaining pins.
  for (const [resource, lane] of Object.entries(current)) {
    const remaining = lane.filter((id) => !ends.has(id) && !pinnedItemIds.has(id));
    while (orders[resource]!.length < lane.length) {
      const original = lane[orders[resource]!.length]!;
      orders[resource]!.push(pinnedItemIds.has(original) ? original : remaining.shift()!);
    }
  }
  return orders;
}
