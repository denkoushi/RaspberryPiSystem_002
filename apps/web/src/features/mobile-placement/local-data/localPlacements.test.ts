import { packPlacement } from '@raspi-system/slip-match-core';
import { describe, expect, it, vi } from 'vitest';

import { createMobileLocalDataStore } from './mobileLocalDataStore';

const row = { id: 'one', manufacturingOrderBarcodeRaw: '001', branchNo: 0, shelfCodeRaw: 'A', updatedAt: '2026-10-28T00:00:00Z',
  fseiban: 'FS1', fhincd: 'MD1', fhinmei: 'テーブル', productNo: '001', machineName: 'DAD3350' };
const snapshot = { version: 'b1', dataUpdatedAt: row.updatedAt, rows: [packPlacement(row)] };

describe('local placement store', () => {
  it('replaces, reads by order, removes and notifies without changing other dataset versions', async () => {
    const store = createMobileLocalDataStore();
    const changed = vi.fn(); const unsubscribe = store.subscribe(changed);
    expect(await store.listPlacements()).toEqual([]);
    await store.replace({ purchase: { version: 'p1', dataUpdatedAt: null, rows: [] },
      placements: { ...snapshot, rows: [...snapshot.rows, packPlacement({ ...row, id: 'two', branchNo: 2 }), packPlacement({ ...row, id: 'other', manufacturingOrderBarcodeRaw: '002' })] } });
    expect((await store.listPlacements()).length).toBe(3);
    expect((await store.listPlacementsByManufacturingOrder('001')).map((r) => r.id)).toEqual(['one', 'two']);
    await store.removePlacement('two');
    expect((await store.listPlacementsByManufacturingOrder('001')).map((r) => r.id)).toEqual(['one']);
    await store.replace({ placements: { ...snapshot, version: 'b2', rows: [] } });
    expect(await store.listPlacements()).toEqual([]);
    expect(await store.versions()).toEqual({ purchase: { version: 'p1', dataUpdatedAt: null }, placements: { version: 'b2', dataUpdatedAt: row.updatedAt } });
    expect(changed).toHaveBeenCalledTimes(3);
    unsubscribe(); await store.removePlacement('missing'); expect(changed).toHaveBeenCalledTimes(3);
  });
  it('keeps rows and version atomic when a replacement cannot be prepared', async () => {
    const store = createMobileLocalDataStore(); await store.replace({ placements: snapshot });
    await expect(store.replace({ placements: { ...snapshot, rows: [], get version(): string { throw new Error('metadata failed'); } } })).rejects.toThrow('metadata failed');
    expect(await store.listPlacements()).toEqual([row]);
    expect((await store.versions()).placements?.version).toBe('b1');
  });
});
