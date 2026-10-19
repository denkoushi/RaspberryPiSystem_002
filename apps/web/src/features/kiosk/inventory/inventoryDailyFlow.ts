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

/** The unit an item is counted in; items without one are counted in 個. */
export function unitLabel(item: { unit?: string | null } | null | undefined): string {
  return item?.unit || '個';
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

export function correctionSummary(before: number, after: number, unit = '個'): string {
  const delta = after - before;
  if (delta === 0) return '記録と同じ数です';
  return delta < 0 ? `記録を ${-delta}${unit} 減らします` : `記録を ${delta}${unit} 増やします`;
}

export function correctionResultMessage(before: number, after: number, unit = '個'): string {
  const delta = after - before;
  if (delta === 0) return `在庫を ${after}${unit} のまま記録しました`;
  return delta < 0
    ? `在庫を ${-delta}${unit} 減らしました（${before} → ${after}${unit}）`
    : `在庫を ${delta}${unit} 増やしました（${before} → ${after}${unit}）`;
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

/** When a drawer was last taken from, as a short badge: 2分前, 3時間前, 昨日, 9/28. */
export function issuedLabel(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  if (minutes < 12 * 60) return `${Math.floor(minutes / 60)}時間前`;
  const day = (value: Date) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(value);
  if (day(at) === day(now)) return '今日';
  if (day(at) === day(new Date(now.getTime() - 86400000))) return '昨日';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).format(at);
}
