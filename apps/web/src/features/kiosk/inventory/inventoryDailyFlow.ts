import type { InventoryCompartment, InventoryItem, InventoryTag } from '../../../api/client';

const ACTION_LABELS: Record<string, string> = {
  ISSUE: '持ち出し',
  RESTOCK: '補充',
  CORRECTION: '数の修正',
  CANCEL: '取消',
};

export function inventoryActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function formatSignedDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function compartmentLocationText(compartment: Pick<InventoryCompartment, 'area' | 'shelfNumber' | 'drawerNumber'>): string {
  return `${compartment.area} / 棚${compartment.shelfNumber} / 引出し${compartment.drawerNumber}`;
}

/** A compartment chosen by touch behaves like a scanned item tag of that compartment. */
export function pickedCompartmentTag(compartment: InventoryCompartment): InventoryTag {
  return {
    id: `picked-${compartment.id}`,
    uid: compartment.itemTagUid ?? '',
    kind: 'ITEM',
    quantity: null,
    compartment,
  };
}

export function correctionSummary(before: number, after: number): string {
  const delta = after - before;
  if (delta === 0) return '記録と同じ数です';
  return delta < 0 ? `記録を ${-delta}個 減らします` : `記録を ${delta}個 増やします`;
}

export function correctionResultMessage(before: number, after: number): string {
  const delta = after - before;
  if (delta === 0) return `在庫を ${after}個 のまま記録しました`;
  return delta < 0
    ? `在庫を ${-delta}個 減らしました（${before} → ${after}個）`
    : `在庫を ${delta}個 増やしました（${before} → ${after}個）`;
}

export type InventoryShelfGroup = {
  shelfNumber: number;
  compartments: InventoryCompartment[];
};

export type InventoryAreaGroup = {
  area: string;
  shelves: InventoryShelfGroup[];
};

/** Groups registered compartments as area → shelf → drawer for the tag-less picker. */
export function groupCompartmentsByLocation(items: InventoryItem[]): InventoryAreaGroup[] {
  const areas = new Map<string, Map<number, InventoryCompartment[]>>();
  for (const item of items) {
    for (const compartment of item.compartments) {
      const shelves = areas.get(compartment.area) ?? new Map<number, InventoryCompartment[]>();
      const drawers = shelves.get(compartment.shelfNumber) ?? [];
      drawers.push(compartment);
      shelves.set(compartment.shelfNumber, drawers);
      areas.set(compartment.area, shelves);
    }
  }
  return [...areas.entries()]
    .sort(([a], [b]) => a.localeCompare(b, 'ja'))
    .map(([area, shelves]) => ({
      area,
      shelves: [...shelves.entries()]
        .sort(([a], [b]) => a - b)
        .map(([shelfNumber, compartments]) => ({
          shelfNumber,
          compartments: [...compartments].sort((a, b) => a.drawerNumber - b.drawerNumber),
        })),
    }));
}
