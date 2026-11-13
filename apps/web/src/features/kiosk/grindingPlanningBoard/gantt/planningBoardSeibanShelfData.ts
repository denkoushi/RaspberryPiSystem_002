import { normalizeMachineName } from '../../productionSchedule/machineName';
import { compareProcessOrder, resolveGrindingPlanningBoardDueDate, resolveGrindingPlanningBoardResource } from '../sortGrindingPlanningBoardItems';

import { planningBoardPartKey } from './planningBoardGanttLayout';

import type { GanttBar } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export type SeibanShelfTile = {
  item: GrindingPlanningBoardItem;
  resource: string | null;
  placed: boolean;
  late: boolean;
  arrivalPending: boolean;
};
export type SeibanShelfPart = {
  key: string;
  name: string;
  code: string;
  quantity: number | null;
  units: SeibanShelfTile[][];
};
export type SeibanShelfColumn = {
  seiban: string;
  color: string;
  model: string;
  due: string | null;
  placed: number;
  total: number;
  late: boolean;
  parts: SeibanShelfPart[];
};

/** Keeps the projection's item identities: operation ranges share a physical piece, never a new saved state. */
export function buildPlanningBoardSeibanShelf(
  items: readonly GrindingPlanningBoardItem[], bars: readonly GanttBar[],
  resources: readonly string[], colors: ReadonlyMap<string, string>
): SeibanShelfColumn[] {
  const pendingIds = new Set(bars.filter(bar => bar.arrivalPending).map(bar => bar.item.itemId));
  const lateIds = new Set(bars.filter(bar => bar.tone === 'late').map(bar => bar.item.itemId));
  const bySeiban = new Map<string, Map<string, GrindingPlanningBoardItem[]>>();
  for (const item of new Map(items.map(item => [item.itemId, item])).values()) {
    if (!colors.has(item.fseiban)) continue;
    let parts = bySeiban.get(item.fseiban);
    if (!parts) { parts = new Map(); bySeiban.set(item.fseiban, parts); }
    const key = planningBoardPartKey(item);
    const part = parts.get(key) ?? [];
    part.push(item); parts.set(key, part);
  }
  return [...colors].flatMap(([seiban, color]) => {
    const parts = bySeiban.get(seiban);
    if (!parts) return [];
    let due: string | null = null;
    let model = '';
    let placed = 0;
    let total = 0;
    let late = false;
    const shelfParts = [...parts].map(([key, members]): SeibanShelfPart => {
      members.sort((a, b) => (a.piecePosition ?? Infinity) - (b.piecePosition ?? Infinity)
        || compareProcessOrder(a.processOrder, b.processOrder)
        || (a.opRange?.fromOpNo ?? 0) - (b.opRange?.fromOpNo ?? 0));
      const units = new Map<string, SeibanShelfTile[]>();
      for (const item of members) {
        const itemDue = resolveGrindingPlanningBoardDueDate(item, 'alternate');
        if (itemDue && (!due || itemDue < due)) due = itemDue;
        if (!model) model = normalizeMachineName(item.machineName);
        const resource = resolveGrindingPlanningBoardResource(item, 'alternate');
        const tile = { item, resource, placed: resource !== null && resources.includes(resource), late: lateIds.has(item.itemId), arrivalPending: pendingIds.has(item.itemId) };
        placed += Number(tile.placed); total++;
        late ||= tile.late;
        const unitKey = item.kind === 'piece' && item.opRange && item.pieceId ? item.pieceId : item.itemId;
        const unit = units.get(unitKey) ?? [];
        unit.push(tile); units.set(unitKey, unit);
      }
      const quantities = members.map(item => item.parentPlannedQuantity ?? item.plannedQuantity).filter((value): value is number => value != null);
      return { key, name: members[0]!.fhinmei ?? '', code: members[0]!.fhincd,
        quantity: quantities.length ? Math.max(...quantities) : null, units: [...units.values()] };
    });
    return [{ seiban, color, model, due, placed, total, late, parts: shelfParts }];
  });
}
