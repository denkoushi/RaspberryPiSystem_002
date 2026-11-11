import { resolveGrindingPlanningBoardDueDate } from '../sortGrindingPlanningBoardItems';

import { planningBoardLaneOrder } from './planningBoardAutoOrder';
import { ganttRequiredMinutes, isUnitPiece, unitSetupMinutesByResource } from './planningBoardUnitSegments';

import type { GanttLayoutOptions } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export type UnitOrderMethod = 'group' | 'round' | 'balance';
export type UnitOrderResourceChange = { itemId: string; resourceCd: string; previousResourceCd: string | null };

type Constraints = {
  visibleItemIds: ReadonlySet<string>;
  canMoveResource: (item: GrindingPlanningBoardItem, target: string) => boolean;
  hasPendingSeiban: (fseiban: string) => boolean;
};

/** Refill movable slots only; every other lane and fixed index retains its current order. */
export function planningBoardUnitOrder(options: GanttLayoutOptions, resources: readonly string[], method: UnitOrderMethod, constraints: Constraints) {
  const current = planningBoardLaneOrder(options);
  const proposal = Object.fromEntries(Object.entries(current).map(([resource, ids]) => [resource, [...ids]]));
  const byId = new Map(options.items.map(item => [item.itemId, item]));
  const lanes = resources.map(resource => (current[resource] ?? []).map(id => byId.get(id)!));
  const rank = new Map(lanes.flat().map((item, index) => [item.itemId, index]));
  const origin = new Map(lanes.flatMap((lane, index) => lane.map(item => [item.itemId, resources[index]!] as const)));
  const movable = (item: GrindingPlanningBoardItem) => isUnitPiece(item) && !item.orderPinned && !item.specialDue && constraints.visibleItemIds.has(item.itemId);
  const due = (item: GrindingPlanningBoardItem) => resolveGrindingPlanningBoardDueDate(item, options.allocation) ?? '9999-12-31';
  const compare = (a: GrindingPlanningBoardItem, b: GrindingPlanningBoardItem) => due(a).localeCompare(due(b)) || rank.get(a.itemId)! - rank.get(b.itemId)!;
  const groups = (items: GrindingPlanningBoardItem[]) => {
    const parts = new Map<string, GrindingPlanningBoardItem[]>();
    for (const item of items) {
      const part = parts.get(item.fhincd);
      if (part) part.push(item);
      else parts.set(item.fhincd, [item]);
    }
    return [...parts.values()].map(part => part.sort(compare)).sort((a, b) =>
      due(a[0]!).localeCompare(due(b[0]!)) || Math.min(...a.map(item => rank.get(item.itemId)!)) - Math.min(...b.map(item => rank.get(item.itemId)!)));
  };
  const setup = unitSetupMinutesByResource(options.resourceMinutes);
  const minutes = (items: GrindingPlanningBoardItem[]) => items.reduce((sum, item) => sum + (ganttRequiredMinutes(item) ?? 0), 0);
  const assigned = lanes.map(lane => lane.filter(movable));
  const resourceChanges: UnitOrderResourceChange[] = [];
  if (method === 'balance' && resources.length === 2) {
    const transferable = (item: GrindingPlanningBoardItem) => movable(item) && !constraints.hasPendingSeiban(item.fseiban) &&
      constraints.canMoveResource(item, resources[0] === origin.get(item.itemId) ? resources[1]! : resources[0]!);
    const loads = lanes.map((lane, index) => {
      let previousPart: string | undefined;
      return lane.reduce((sum, item) => {
        const setupMinutes = isUnitPiece(item) && previousPart !== item.fhincd ? setup.get(resources[index]!)?.get(item.fhincd) ?? 0 : 0;
        previousPart = item.fhincd;
        return sum + (transferable(item) ? 0 : (ganttRequiredMinutes(item) ?? 0) + setupMinutes);
      }, 0);
    });
    assigned.forEach((_, index) => { assigned[index] = lanes[index]!.filter(item => movable(item) && !transferable(item)); });
    const minimum = lanes.map(lane => lane.reduce((last, item, index) => movable(item) ? last : index + 1, 0));
    const counts = lanes.map(lane => lane.filter(item => !transferable(item)).length);
    const remaining = lanes.map(lane => lane.filter(transferable).length);
    const candidates = groups(lanes.flat().filter(transferable));
    // With machine-specific setup times, use the larger setup for deterministic part priority.
    const total = (part: GrindingPlanningBoardItem[]) => minutes(part) + Math.max(...resources.map(resource => setup.get(resource)?.get(part[0]!.fhincd) ?? 0));
    candidates.sort((a, b) => due(a[0]!).localeCompare(due(b[0]!)) || total(b) - total(a));
    for (const part of candidates) {
      part.forEach(item => {
        const index = resources.indexOf(origin.get(item.itemId)!);
        remaining[index] = remaining[index]! - 1;
      });
      const preferred = loads[0]! <= loads[1]! ? 0 : 1;
      const feasible = (target: number) => counts.every((count, index) => count + remaining[index]! + (index === target ? part.length : 0) >= minimum[index]!);
      const target = feasible(preferred) ? preferred : feasible(1 - preferred) ? 1 - preferred : null;
      // A fixed bar near the bottom can require pieces above it; retaining the part avoids empty indices.
      for (const item of part) {
        const index = target ?? resources.indexOf(origin.get(item.itemId)!);
        assigned[index]!.push(item);
        counts[index] = counts[index]! + 1;
        loads[index]! += ganttRequiredMinutes(item) ?? 0;
        if (resources[index] !== origin.get(item.itemId)) resourceChanges.push({ itemId: item.itemId, resourceCd: resources[index]!, previousResourceCd: origin.get(item.itemId)! });
      }
      for (const index of new Set(part.map(item => target ?? resources.indexOf(origin.get(item.itemId)!)))) {
        loads[index]! += setup.get(resources[index]!)?.get(part[0]!.fhincd) ?? 0;
      }
    }
  }
  resources.forEach((resource, index) => {
    const parts = groups(assigned[index]!);
    const ordered = method === 'round'
      ? Array.from({ length: Math.max(0, ...parts.map(part => part.length)) }, (_, round) => parts.flatMap(part => part[round] ? [part[round]!] : [])).flat()
      : parts.flat();
    let next = 0;
    const lane: string[] = [];
    for (const item of lanes[index]!) {
      if (!movable(item)) lane.push(item.itemId);
      else if (next < ordered.length) lane.push(ordered[next++]!.itemId);
    }
    lane.push(...ordered.slice(next).map(item => item.itemId));
    proposal[resource] = lane;
  });
  return { proposal, resourceChanges };
}
