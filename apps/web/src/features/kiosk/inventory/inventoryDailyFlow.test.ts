import { describe, expect, it } from 'vitest';

import {
  correctionResultMessage,
  correctionSummary,
  groupCompartmentsByLocation,
  pickedCompartmentTag,
} from './inventoryDailyFlow';

import type { InventoryCompartment, InventoryItem } from '../../../api/client';

function compartment(id: string, area: string, shelfNumber: number, drawerNumber: number, itemTagUid: string | null = `${id}-uid`) {
  return { id, area, shelfNumber, drawerNumber, stockQuantity: 1, itemTagUid, item: { id: `${id}-item`, name: id, photos: [] } } as unknown as InventoryCompartment;
}

describe('inventoryDailyFlow', () => {
  it('groups compartments of every item by area, shelf and drawer in order', () => {
    const items = [
      { compartments: [compartment('b', 'A-2', 1, 3), compartment('a', 'A-1', 2, 1)] },
      { compartments: [compartment('c', 'A-2', 1, 1)] },
    ] as unknown as InventoryItem[];

    const groups = groupCompartmentsByLocation(items);

    expect(groups.map((group) => group.area)).toEqual(['A-1', 'A-2']);
    expect(groups[1].shelves[0].compartments.map((entry) => entry.id)).toEqual(['c', 'b']);
  });

  it('turns a picked compartment into an item tag, with an empty uid when it has no tag', () => {
    expect(pickedCompartmentTag(compartment('a', 'A-1', 1, 1))).toMatchObject({ kind: 'ITEM', uid: 'a-uid' });
    expect(pickedCompartmentTag(compartment('b', 'A-1', 1, 2, null)).uid).toBe('');
  });

  it('describes the correction direction in plain words', () => {
    expect(correctionSummary(12, 9)).toBe('記録を 3個 減らします');
    expect(correctionSummary(9, 12)).toBe('記録を 3個 増やします');
    expect(correctionSummary(5, 5)).toBe('記録と同じ数です');
    expect(correctionResultMessage(12, 9)).toBe('在庫を 3個 減らしました（12 → 9個）');
  });
});
