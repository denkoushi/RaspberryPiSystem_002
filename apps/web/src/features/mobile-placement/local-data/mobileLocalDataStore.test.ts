import { packBasePurchase, packPurchase, packSchedule } from '@raspi-system/slip-match-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ openDB: vi.fn() }));
vi.mock('idb', () => ({ openDB: mocks.openDB }));

import { createMobileLocalDataStore } from './mobileLocalDataStore';

const purchaseRow = { purchaseOrderNo: '1234567890', seiban: 'FS1', purchasePartName: 'Part', masterPartName: '',
  machineName: '', purchasePartCodeRaw: 'MD1', purchasePartCodeNormalized: 'MD1', purchasePartCodeMatchKey: 'MD1',
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
          objectStore: (kind: string) => kind === 'metadata' ? metadata : kind === 'purchaseEnrichment' ? { get: async () => undefined } : {
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

describe('database v4 upgrade', () => {
  it.each([1, 2, 3])('keeps legacy joined purchase readable after upgrading from v%s', async (oldVersion) => {
    vi.stubGlobal('indexedDB', {});
    const metadata = new Map(Object.entries(versions));
    const stores = new Map<string, unknown[]>([['known', ['FS1']], ['purchase', [purchaseRow]], ['schedule', [scheduleRow]],
      ...(oldVersion >= 2 ? [['placements', [{ id: 'b1' }]] as [string, unknown[]]] : [])]);
    if (oldVersion === 3) stores.set('purchaseEnrichment', [{ version: 'e1' }]);
    const createIndex = vi.fn();
    const createObjectStore = vi.fn((name: string) => {
      if (stores.has(name)) throw new Error(`Existing store recreated: ${name}`);
      stores.set(name, []); return { createIndex };
    });
    const objectStore = (kind: string) => kind === 'metadata'
      ? { get: async (key: string) => metadata.get(key), delete: (key: string) => { metadata.delete(key); } }
      : { clear: () => { stores.set(kind, []); }, get: async () => undefined,
        index: () => ({ getAll: async () => stores.get(kind) }) };
    const database = { createObjectStore, transaction: () => ({ objectStore }),
      getAllFromIndex: async (kind: string) => stores.get(kind) };
    mocks.openDB.mockImplementation(async (_name, _version, options) => {
      options.upgrade(database, oldVersion, 4, { objectStore }); return database;
    });
    const store = createMobileLocalDataStore('existing');
    expect((await store.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows).toHaveLength(1);
    expect(stores.get('purchase')).toEqual([purchaseRow]); expect(metadata.get('purchase')).toEqual(versions.purchase);
    expect(await store.listScheduleByProductNo(scheduleRow.productNo)).toEqual([scheduleRow]);
    expect(metadata.get('schedule')).toEqual(versions.schedule);
    expect(stores.get('known')).toEqual(['FS1']);
    if (oldVersion >= 2) expect(stores.get('placements')).toEqual([{ id: 'b1' }]);
    expect(mocks.openDB).toHaveBeenCalledWith('existing', 4, expect.anything());
    if (oldVersion < 3) expect(createObjectStore).toHaveBeenCalledWith('purchaseEnrichment');
    else expect(stores.get('purchaseEnrichment')).toEqual([{ version: 'e1' }]);
    expect(createObjectStore).toHaveBeenCalledWith('stagingPurchase', { keyPath: 'ordinal' });
    expect(createObjectStore).toHaveBeenCalledWith('stagingSchedule', { keyPath: 'ordinal' });
    expect(createObjectStore).toHaveBeenCalledWith('stagingPlacements', { keyPath: 'id' });
  });
});

describe('IndexedDB independent purchase reads', () => {
  it('reads base rows and enrichment in one transaction and discards enrichment when returning to legacy', async () => {
    vi.stubGlobal('indexedDB', {});
    const tables = new Map<string, Map<unknown, unknown>>();
    const table = (name: string) => {
      if (!tables.has(name)) tables.set(name, new Map());
      return tables.get(name)!;
    };
    const objectStore = (name: string) => ({
      get: async (key: unknown) => table(name).get(key),
      put: async (value: { ordinal?: number }, key?: unknown) => { table(name).set(key ?? value.ordinal, value); },
      delete: async (key: unknown) => { table(name).delete(key); },
      clear: async () => { table(name).clear(); },
      index: () => ({ getAll: async () => [...table(name).values()] })
    });
    const transaction = vi.fn((names: string | string[]) => ({ objectStore, store: objectStore(String(names)),
      addEventListener: vi.fn(), done: Promise.resolve() }));
    mocks.openDB.mockResolvedValue({ transaction });
    const store = createMobileLocalDataStore();
    await store.replace({ purchase: { ...versions.purchase, format: 2, rows: [packBasePurchase(purchaseRow)] },
      purchaseEnrichment: { version: 'e1', dataUpdatedAt: null, rows: [['match', 'MD1', 'master']] } });
    expect((await store.lookupPurchase('1234567890'))?.rows[0].masterPartName).toBe('master');
    expect(transaction).toHaveBeenLastCalledWith(['metadata', 'purchase', 'purchaseEnrichment']);
    const reloaded = createMobileLocalDataStore();
    expect((await reloaded.lookupPurchase('1234567890'))?.rows[0].masterPartName).toBe('master');
    await reloaded.replace({ purchaseEnrichment: { version: 'e2', dataUpdatedAt: null, rows: [] } });
    expect((await reloaded.lookupPurchase('1234567890'))?.rows[0].masterPartName).toBe('');
    await reloaded.replace({ purchase: { ...versions.purchase, rows: [packPurchase({ ...purchaseRow, masterPartName: 'legacy' })] } });
    expect((await reloaded.lookupPurchase('1234567890'))?.rows[0].masterPartName).toBe('legacy');
    expect((await reloaded.versions()).purchaseEnrichment).toBeUndefined();
    expect(table('purchaseEnrichment').size).toBe(0);
  });
});

describe('IndexedDB staged snapshots', () => {
  it('persists page progress across store reloads and promotes rows, known seibans and metadata in one transaction', async () => {
    vi.stubGlobal('indexedDB', {});
    const tables = new Map<string, Map<unknown, unknown>>();
    const table = (name: string) => {
      if (!tables.has(name)) tables.set(name, new Map());
      return tables.get(name)!;
    };
    const objectStore = (name: string) => ({
      get: async (key: unknown) => table(name).get(key),
      put: async (value: { ordinal?: number; id?: string }, key?: unknown) => { table(name).set(key ?? value.id ?? value.ordinal, value); },
      delete: async (key: unknown) => { table(name).delete(key); },
      clear: async () => { table(name).clear(); },
      index: () => ({ getAll: async () => [...table(name).values()] }),
      openCursor: async () => {
        const values = [...table(name).values()];
        const cursor = (i: number): unknown => i < values.length ? { value: values[i], continue: async () => cursor(i + 1) } : null;
        return cursor(0);
      }
    });
    const transaction = vi.fn((names: string | string[]) => ({ objectStore, store: objectStore(String(names)),
      addEventListener: vi.fn(), done: Promise.resolve() }));
    mocks.openDB.mockResolvedValue({ transaction, get: async (name: string, key: unknown) => table(name).get(key),
      getAll: async (name: string) => [...table(name).values()] });
    const store = createMobileLocalDataStore();
    await store.replace({ purchase: { ...versions.purchase, rows: [packPurchase(purchaseRow)] },
      schedule: { ...versions.schedule, rows: [packSchedule(scheduleRow)], knownFseibans: ['FS1'] } });
    const pageVersion = { version: 'p2', dataUpdatedAt: null, format: 2 as const };
    await store.writeStagingPage('purchase', pageVersion, 1, 3, [packBasePurchase({ ...purchaseRow, purchasePartName: 'new' })], 1);
    await store.writeStagingPage('purchase', pageVersion, 2, 3, [packBasePurchase(purchaseRow)], 1);
    const reloaded = createMobileLocalDataStore();
    expect(await reloaded.stagingState('purchase')).toEqual({ ...pageVersion, nextPage: 3, pageCount: 3, pageSize: 1 });
    expect((await reloaded.lookupPurchase('1234567890'))?.rows[0].purchasePartName).toBe('Part');
    await reloaded.writeStagingPage('purchase', pageVersion, 3, 3, [packBasePurchase(purchaseRow)], 1);
    await reloaded.promoteStaging('purchase');
    expect(transaction).toHaveBeenLastCalledWith(['metadata', 'purchase', 'stagingPurchase', 'known'], 'readwrite');
    expect([...table('purchase').keys()]).toEqual([0, 1, 2]);
    expect((await reloaded.versions()).purchase).toEqual(pageVersion);
    expect(table('stagingPurchase').size).toBe(0);
    expect(await reloaded.stagingState('purchase')).toBeUndefined();
    const nextSchedule = { version: 's2', dataUpdatedAt: null };
    await reloaded.writeStagingPage('schedule', nextSchedule, 1, 2, [packSchedule(scheduleRow)], 1, ['NEW']);
    expect(table('known').get('fseibans')).toEqual(['FS1']);
    await reloaded.writeStagingPage('schedule', nextSchedule, 2, 2, [packSchedule(scheduleRow)], 1);
    await reloaded.promoteStaging('schedule');
    expect(transaction).toHaveBeenLastCalledWith(['metadata', 'schedule', 'stagingSchedule', 'known'], 'readwrite');
    expect(table('known').get('fseibans')).toEqual(['NEW']);
    expect((await reloaded.versions()).schedule).toEqual(nextSchedule);
    expect(table('metadata').has('staging:schedule')).toBe(false);
  });
});
