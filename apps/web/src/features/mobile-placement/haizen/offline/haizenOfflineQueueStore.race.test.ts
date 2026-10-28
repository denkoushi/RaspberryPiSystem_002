import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHaizenOfflineQueueStore } from './haizenOfflineQueueStore';

import type { HaizenQueueRecord } from './haizenOfflineQueueStore';

const db = { getAll: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock('idb', () => ({ openDB: () => Promise.resolve(db) }));
const record: HaizenQueueRecord = {
  clientRecordId: 'new', slipKind: 'purchase_order', number: '4501238876', shelfCode: '外-1',
  scannedAt: '2026-10-23T00:00:00.000Z', status: 'pending'
};
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('haizen offline store with IndexedDB', () => {
  it('keeps a record saved while an earlier read was still in flight', async () => {
    vi.stubGlobal('indexedDB', {});
    let readDone!: (records: HaizenQueueRecord[]) => void;
    let writeDone!: () => void;
    db.getAll.mockImplementationOnce(() => new Promise((resolve) => { readDone = resolve; }));
    db.put.mockImplementationOnce(() => new Promise<void>((resolve) => { writeDone = resolve; }));
    const store = createHaizenOfflineQueueStore();
    const listing = store.list();
    await vi.waitFor(() => expect(db.getAll).toHaveBeenCalled());
    const saving = store.put(record);
    readDone([]);
    expect(await listing).toEqual([record]);
    writeDone();
    await saving;
    db.getAll.mockResolvedValueOnce([record]);
    expect(await store.list()).toEqual([record]);
  });
});
