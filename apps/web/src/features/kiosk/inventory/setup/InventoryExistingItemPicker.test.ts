import { describe, expect, it } from 'vitest';

import { filterExistingItems } from './InventoryExistingItemPicker';

import type { InventoryItem } from '../../../../api/client';

const item: InventoryItem = {
  id: 'one', name: '既存治具', model: 'Model-A', maker: 'Maker-B', itemCode: 'RI-42', toolName: 'End Mill',
  usage: null, category: null, area: 'unrelated', note: null, unit: null, photos: [], compartments: [],
};
const items: InventoryItem[] = [
  { ...item, compartments: [
    { id: 'c1', labelNumber: 9876, stockQuantity: 1, area: 'other 北', shelfNumber: 1, drawerNumber: 1, itemTagUid: null, item },
    { id: 'c2', labelNumber: 12, stockQuantity: 1, area: 'machine 南', shelfNumber: 2, drawerNumber: 3, itemTagUid: null, item },
  ] },
  { ...item, id: 'no-location', name: '別の工具', model: null, maker: null, itemCode: 'RI-9000', toolName: null },
];

describe('filterExistingItems', () => {
  it.each(['既存', 'model-a', 'MAKER-b', 'ri-42', 'end MILL', '0012', '001', '12', ' ００１２　', '9876'])('matches text or any compartment label: %s', (query) => {
    expect(filterExistingItems(items, { query, scope: 'all', machine: 'machine' }).map(({ id }) => id)).toEqual(['one']);
  });

  it('also matches numeric queries in text fields', () => {
    expect(filterExistingItems(items, { query: '42', scope: 'all', machine: 'machine' })).toEqual([items[0]]);
  });

  it('scopes by any compartment machine and excludes items without compartments', () => {
    expect(filterExistingItems(items, { query: '', scope: 'machine', machine: 'machine' })).toEqual([items[0]]);
    expect(filterExistingItems(items, { query: '', scope: 'machine', machine: 'unrelated' })).toEqual([]);
    expect(filterExistingItems(items, { query: '', scope: 'all', machine: 'machine' })).toEqual(items);
  });

  it.each(['0013', '1.2', 'not found'])('rejects non-matching queries: %s', (query) => {
    expect(filterExistingItems(items, { query, scope: 'all', machine: 'machine' })).toEqual([]);
  });
});
