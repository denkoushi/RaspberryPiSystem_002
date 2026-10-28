import { packPurchase, packSchedule } from '@raspi-system/slip-match-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openDB: vi.fn() }));
vi.mock('idb', () => ({ openDB: mocks.openDB }));

import { createMobileLocalDataStore } from './mobileLocalDataStore';

const purchaseRow = { purchaseOrderNo: '1234567890', seiban: 'FS1', purchasePartName: 'Part', masterPartName: null,
  machineName: null, purchasePartCodeRaw: 'MD1', purchasePartCodeNormalized: 'MD1', purchasePartCodeMatchKey: 'MD1',
  acceptedQuantity: 1, plannedStartDate: null, ordinal: 0 };
const scheduleRow = { rowId: 'r1', fseiban: 'FS1', productNo: 'T1', fhincd: 'MD1', fhinmei: 'Part', fsigencd: 'M', fkojun: 1, ordinal: 0 };
const versions = { purchase: { version: 'p1', dataUpdatedAt: null }, schedule: { version: 's1', dataUpdatedAt: null } };
const input = { transferOrderBarcodeRaw: 'T1', actualOrderBarcodeRaw: purchaseRow.purchaseOrderNo, actualFseibanRaw: '' };

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('IndexedDB replacement failure', () => {
  it.each(['abort succeeds', 'already aborted', 'abort fails', 'already committed'] as const)(
    '%s: reads the old snapshot only when rollback is known to be safe', async (mode) => {
      vi.stubGlobal('indexedDB', {});
      const quota = new DOMException('quota exceeded', 'QuotaExceededError');
      let onAbort = () => {};
      let rejectDone!: (error: Error) => void;
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
      const writeStore = {
        clear: vi.fn().mockResolvedValue(undefined),
        put: vi.fn(async () => {
          if (mode === 'already aborted') onAbort();
          if (mode === 'already committed') resolveDone(); else rejectDone(quota);
          throw quota;
        })
      };
      const tx = {
        done, objectStore: () => writeStore,
        addEventListener: (_event: string, callback: () => void) => { onAbort = callback; },
        abort: vi.fn(() => {
          if (mode !== 'abort succeeds') throw new DOMException('finished', 'InvalidStateError');
          onAbort();
        })
      };
      const metadata = { get: async (kind: keyof typeof versions) => versions[kind] };
      const database = {
        transaction: (_stores: unknown, mode?: string) => mode === 'readwrite' ? tx : {
          store: metadata,
          objectStore: (kind: string) => kind === 'metadata' ? metadata : {
            index: () => ({ getAll: async (key: string) => kind === 'purchase'
              ? key === purchaseRow.purchaseOrderNo ? [purchaseRow] : []
              : key === 'T1' || key === 'FS1' ? [scheduleRow] : [] })
          }
        },
        get: async () => ['FS1']
      };
      mocks.openDB.mockResolvedValue(database);
      const store = createMobileLocalDataStore();
      await expect(store.replace({ purchase: { version: 'p2', dataUpdatedAt: null, rows: [packPurchase(purchaseRow)] },
        schedule: { version: 's2', dataUpdatedAt: null, rows: [packSchedule(scheduleRow)], knownFseibans: ['FS2'] }
      })).rejects.toThrow('quota');
      expect(writeStore.clear).toHaveBeenCalled();
      expect(tx.abort).toHaveBeenCalledOnce();
      expect(await store.versions()).toEqual(versions);
      if (mode === 'abort succeeds' || mode === 'already aborted') {
        expect((await store.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows).toEqual([purchaseRow]);
        expect(await store.verify(input)).toMatchObject({ ok: true });
        expect(await store.snapNative(['FS1'], '')).toMatchObject({ fseiban: 'FS1' });
      } else {
        expect(await store.lookupPurchase(purchaseRow.purchaseOrderNo)).toBeNull();
        expect(await store.verify(input)).toBeNull();
        expect(await store.snapNative(['FS1'], '')).toBeNull();
      }
    }
  );
});

describe('database v2 upgrade', () => {
  it('adds only placements to a seeded v1 database and retains purchase/schedule data', async () => {
    vi.stubGlobal('indexedDB', {});
    const stores = new Map<string, unknown[]>([['metadata', []], ['known', []], ['purchase', [purchaseRow]], ['schedule', [scheduleRow]]]);
    const createIndex = vi.fn();
    const createObjectStore = vi.fn((name: string) => {
      if (stores.has(name)) throw new Error(`Existing store recreated: ${name}`);
      stores.set(name, []); return { createIndex };
    });
    const database = {
      createObjectStore,
      transaction: () => ({ objectStore: (kind: string) => kind === 'metadata'
        ? { get: async (key: keyof typeof versions) => versions[key] }
        : { index: () => ({ getAll: async () => stores.get(kind) }) } }),
      getAllFromIndex: async (kind: string) => stores.get(kind)
    };
    mocks.openDB.mockImplementation(async (_name, _version, options) => {
      options.upgrade(database, 1, 2); return database;
    });
    const store = createMobileLocalDataStore('existing-v1');
    expect((await store.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows).toEqual([purchaseRow]);
    expect(await store.listScheduleByProductNo(scheduleRow.productNo)).toEqual([scheduleRow]);
    expect(mocks.openDB).toHaveBeenCalledWith('existing-v1', 2, expect.anything());
    expect(createObjectStore).toHaveBeenCalledExactlyOnceWith('placements', { keyPath: 'id' });
    expect(createIndex).toHaveBeenCalledExactlyOnceWith('manufacturingOrderBarcodeRaw', 'manufacturingOrderBarcodeRaw');
    expect([...stores.keys()]).toEqual(['metadata', 'known', 'purchase', 'schedule', 'placements']);
  });
});
