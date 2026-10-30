import { packBasePurchase, packPlacement, packPurchase, packSchedule } from '@raspi-system/slip-match-core';
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

describe('database v5 upgrade', () => {
  it.each([1, 2, 3, 4])('keeps legacy joined purchase readable after upgrading from v%s', async (oldVersion) => {
    vi.stubGlobal('indexedDB', {});
    const metadata = new Map(Object.entries(versions));
    const stores = new Map<string, unknown[]>([['known', ['FS1']], ['purchase', [purchaseRow]], ['schedule', [scheduleRow]],
      ...(oldVersion >= 2 ? [['placements', [{ id: 'b1' }]] as [string, unknown[]]] : [])]);
    if (oldVersion >= 3) stores.set('purchaseEnrichment', [{ version: 'e1' }]);
    if (oldVersion >= 4) for (const kind of ['stagingPurchase', 'stagingSchedule', 'stagingPlacements']) stores.set(kind, []);
    const createIndex = vi.fn();
    const createObjectStore = vi.fn((name: string) => {
      if (stores.has(name)) throw new Error(`Existing store recreated: ${name}`);
      stores.set(name, []); return { createIndex };
    });
    const objectStore = (kind: string) => kind === 'metadata'
      ? { get: async (key: string) => metadata.get(key), delete: (key: string) => { metadata.delete(key); } }
      : { createIndex, clear: () => { stores.set(kind, []); }, get: async () => undefined,
        index: () => ({ getAll: async () => stores.get(kind) }) };
    const database = { createObjectStore, transaction: () => ({ objectStore, store: objectStore('metadata') }),
      getAllFromIndex: async (kind: string) => stores.get(kind) };
    mocks.openDB.mockImplementation(async (_name, _version, options) => {
      options.upgrade(database, oldVersion, 5, { objectStore }); return database;
    });
    const store = createMobileLocalDataStore('existing');
    expect((await store.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows).toHaveLength(1);
    expect(stores.get('purchase')).toEqual([purchaseRow]); expect(metadata.get('purchase')).toEqual(versions.purchase);
    expect(await store.listScheduleByProductNo(scheduleRow.productNo)).toEqual([scheduleRow]);
    expect(metadata.get('schedule')).toEqual(versions.schedule);
    expect(stores.get('known')).toEqual(['FS1']);
    if (oldVersion >= 2) expect(stores.get('placements')).toEqual([{ id: 'b1' }]);
    expect(mocks.openDB).toHaveBeenCalledWith('existing', 5, expect.anything());
    if (oldVersion < 3) expect(createObjectStore).toHaveBeenCalledWith('purchaseEnrichment');
    else expect(stores.get('purchaseEnrichment')).toEqual([{ version: 'e1' }]);
    if (oldVersion < 4) {
      expect(createObjectStore).toHaveBeenCalledWith('stagingPurchase', { keyPath: 'ordinal' });
      expect(createObjectStore).toHaveBeenCalledWith('stagingSchedule', { keyPath: 'ordinal' });
      expect(createObjectStore).toHaveBeenCalledWith('stagingPlacements', { keyPath: 'id' });
    }
    expect(createIndex.mock.calls.slice(-4)).toEqual([['purchaseOrderNo', 'purchaseOrderNo'], ['productNo', 'productNo'],
      ['fseiban', 'fseiban'], ['manufacturingOrderBarcodeRaw', 'manufacturingOrderBarcodeRaw']]);
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
  function setup() {
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
      index: (key: string) => ({ getAll: async (value: string) => [...table(name).values()].filter((row) =>
        (row as Record<string, unknown>)[key] === value) })
    });
    const transaction = vi.fn((names: string | string[]) => ({ objectStore: (name: string) => {
      if (!(Array.isArray(names) ? names : [names]).includes(name)) throw new Error(`Store outside transaction: ${name}`);
      return objectStore(name);
    }, store: objectStore(String(names)),
      addEventListener: vi.fn(), done: Promise.resolve() }));
    mocks.openDB.mockResolvedValue({ transaction, get: async (name: string, key: unknown) => table(name).get(key),
      getAll: async (name: string) => [...table(name).values()],
      getAllFromIndex: async (name: string, key: string, value: string) => objectStore(name).index(key).getAll(value),
      delete: async (name: string, key: string) => objectStore(name).delete(key) });
    return { store: createMobileLocalDataStore(), table, transaction };
  }
  it('persists page progress across store reloads and promotes rows, known seibans and metadata in one transaction', async () => {
    const { store, table, transaction } = setup();
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
    expect(transaction).toHaveBeenLastCalledWith(['metadata'], 'readwrite');
    expect([...table('stagingPurchase').keys()]).toEqual([0, 1, 2]);
    expect([...table('purchase').values()]).toEqual([purchaseRow]);
    expect((await reloaded.versions()).purchase).toEqual(pageVersion);
    expect(table('stagingPurchase').size).toBe(3);
    expect(await reloaded.stagingState('purchase')).toBeUndefined();
    const nextSchedule = { version: 's2', dataUpdatedAt: null };
    await reloaded.writeStagingPage('schedule', nextSchedule, 1, 2, [packSchedule(scheduleRow)], 1, ['NEW']);
    expect(table('known').get('fseibans')).toEqual(['FS1']);
    await reloaded.writeStagingPage('schedule', nextSchedule, 2, 2, [packSchedule(scheduleRow)], 1);
    await reloaded.promoteStaging('schedule');
    expect(transaction).toHaveBeenLastCalledWith(['metadata', 'known'], 'readwrite');
    expect(table('known').get('fseibans')).toEqual(['NEW']);
    expect((await reloaded.versions()).schedule).toEqual(nextSchedule);
    expect(table('metadata').has('staging:schedule')).toBe(false);
  });

  it('alternates two versions, keeps the live buffer readable while staging and discards only the inactive buffer', async () => {
    const { store, table, transaction } = setup();
    await store.replace({ purchase: { ...versions.purchase, rows: [packPurchase(purchaseRow)] } });
    // Supply enrichment for the paged base rows.
    await store.replace({ purchaseEnrichment: { version: 'e1', dataUpdatedAt: null, rows: [] } });
    expect(table('metadata').has('live:purchase')).toBe(false);
    expect((await store.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows[0].purchasePartName).toBe('Part');
    const v2 = { version: 'p2', dataUpdatedAt: null, format: 2 as const };
    await store.writeStagingPage('purchase', v2, 1, 1, [packBasePurchase({ ...purchaseRow, purchasePartName: 'v2' })], 1);
    await store.promoteStaging('purchase');
    expect(transaction).toHaveBeenLastCalledWith(['metadata'], 'readwrite');
    expect(table('purchase').size).toBe(1);
    expect(table('metadata').get('live:purchase')).toEqual({ liveStore: 'stagingPurchase' });
    expect((await store.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows[0].purchasePartName).toBe('v2');
    const reloaded = createMobileLocalDataStore();
    expect((await reloaded.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows[0].purchasePartName).toBe('v2');
    const v3 = { ...v2, version: 'p3' };
    await reloaded.writeStagingPage('purchase', v3, 1, 2, [packBasePurchase({ ...purchaseRow, purchasePartName: 'v3' })], 1);
    expect(transaction).toHaveBeenLastCalledWith(['metadata', 'purchase'], 'readwrite');
    expect((await reloaded.stagingState('purchase'))?.nextPage).toBe(2);
    expect((await reloaded.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows[0].purchasePartName).toBe('v2');
    expect(transaction).toHaveBeenLastCalledWith(['metadata', 'stagingPurchase', 'purchaseEnrichment']);
    await reloaded.discardStaging('purchase');
    expect(table('purchase').size).toBe(0);
    expect(table('stagingPurchase').size).toBe(1);
    expect(await reloaded.stagingState('purchase')).toBeUndefined();
    expect((await reloaded.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows[0].purchasePartName).toBe('v2');
    await reloaded.writeStagingPage('purchase', v3, 1, 1, [packBasePurchase({ ...purchaseRow, purchasePartName: 'v3' })], 1);
    const [, concurrentRead] = await Promise.all([reloaded.promoteStaging('purchase'),
      reloaded.lookupPurchase(purchaseRow.purchaseOrderNo)]);
    expect(concurrentRead?.rows[0].purchasePartName).toBe('v3');
    expect(table('metadata').get('live:purchase')).toEqual({ liveStore: 'purchase' });
    expect(table('stagingPurchase').size).toBe(1);
    expect((await reloaded.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows[0].purchasePartName).toBe('v3');
    await reloaded.writeStagingPage('purchase', { ...v3, version: 'p4' }, 1, 1, [], 1);
    expect(transaction).toHaveBeenLastCalledWith(['metadata', 'stagingPurchase'], 'readwrite');
    expect(table('stagingPurchase').size).toBe(0);
    expect((await reloaded.lookupPurchase(purchaseRow.purchaseOrderNo))?.rows[0].purchasePartName).toBe('v3');
  });

  it('uses promoted schedule indexes for verify and known seibans, and replaces the live buffer', async () => {
    const { store, table, transaction } = setup();
    await store.replace({ purchase: { ...versions.purchase, rows: [packPurchase(purchaseRow)] } });
    const s2 = { version: 's2', dataUpdatedAt: null };
    await store.writeStagingPage('schedule', s2, 1, 1, [packSchedule(scheduleRow)], 1, ['FS1']);
    await store.promoteStaging('schedule');
    expect(await store.listScheduleByProductNo('T1')).toEqual([scheduleRow]);
    expect(await store.verify(input)).toMatchObject({ ok: true });
    expect(transaction).toHaveBeenLastCalledWith(['metadata', 'purchase', 'stagingSchedule']);
    expect(await store.snapNative(['FS1'], '')).toMatchObject({ fseiban: 'FS1' });
    await store.writeStagingPage('schedule', { ...s2, version: 's3' }, 1, 1, [], 1, ['FS2']);
    expect(await store.listScheduleByProductNo('T1')).toEqual([scheduleRow]);
    expect(await store.snapNative(['FS1'], '')).toMatchObject({ fseiban: 'FS1' });
    await store.replace({ schedule: { version: 'replacement', dataUpdatedAt: null,
      rows: [packSchedule({ ...scheduleRow, fhinmei: 'replacement' })], knownFseibans: ['FS3'] } });
    expect(table('metadata').get('live:schedule')).toEqual({ liveStore: 'stagingSchedule' });
    expect((await store.listScheduleByProductNo('T1'))[0].fhinmei).toBe('replacement');
    expect(table('schedule').size).toBe(0);
    await store.discardStaging('schedule');
    expect((await store.listScheduleByProductNo('T1'))[0].fhinmei).toBe('replacement');
    expect(await store.snapNative(['FS3'], '')).toMatchObject({ fseiban: 'FS3' });
  });

  it('reads and edits placements in the promoted buffer', async () => {
    const { store, table } = setup();
    const row = { id: 'b1', manufacturingOrderBarcodeRaw: 'T1', branchNo: 0, shelfCodeRaw: 'A',
      updatedAt: '', fseiban: 'FS1', fhincd: 'MD1', fhinmei: 'Part', productNo: 'T1', machineName: 'M' };
    await store.writeStagingPage('placements', { version: 'b1', dataUpdatedAt: null }, 1, 1, [packPlacement(row)], 1);
    await store.promoteStaging('placements');
    expect(await store.listPlacements()).toEqual([row]);
    expect(await store.listPlacementsByManufacturingOrder('T1')).toEqual([row]);
    expect(await store.listPlacementsByManufacturingOrder('other')).toEqual([]);
    await store.removePlacement(row.id);
    expect(await store.listPlacements()).toEqual([]);
    await store.restorePlacement(row);
    expect(await store.listPlacements()).toEqual([row]);
    await store.writeStagingPage('placements', { version: 'b2', dataUpdatedAt: null }, 1, 1, [], 1);
    await store.discardStaging('placements');
    expect(await store.listPlacements()).toEqual([row]);
    expect(table('placements').size).toBe(0);
    await store.replace({ placements: { version: 'b3', dataUpdatedAt: null, rows: [] } });
    expect(await store.listPlacements()).toEqual([]);
    expect(table('metadata').get('live:placements')).toEqual({ liveStore: 'stagingPlacements' });
  });

});


describe('memory staged snapshots', () => {
  it('keeps live data during staging and discard, and replaces it on successive promotes', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = createMobileLocalDataStore();
    await store.replace({ schedule: { ...versions.schedule, rows: [packSchedule(scheduleRow)], knownFseibans: ['FS1'] } });
    const v2 = { version: 's2', dataUpdatedAt: null };
    await store.writeStagingPage('schedule', v2, 1, 2, [packSchedule({ ...scheduleRow, fhinmei: 'v2' })], 1, ['FS2']);
    await expect(store.promoteStaging('schedule')).rejects.toThrow('Mobile staging incomplete');
    expect(await store.listScheduleByProductNo('T1')).toEqual([scheduleRow]);
    await store.discardStaging('schedule');
    expect(await store.stagingState('schedule')).toBeUndefined();
    expect(await store.listScheduleByProductNo('T1')).toEqual([scheduleRow]);
    await store.writeStagingPage('schedule', v2, 1, 1, [packSchedule({ ...scheduleRow, fhinmei: 'v2' })], 1, ['FS2']);
    await store.promoteStaging('schedule');
    expect((await store.listScheduleByProductNo('T1'))[0].fhinmei).toBe('v2');
    expect(await store.snapNative(['FS2'], '')).toMatchObject({ fseiban: 'FS2' });
    const v3 = { version: 's3', dataUpdatedAt: null };
    await store.writeStagingPage('schedule', v3, 1, 1, [], 1, []);
    expect((await store.listScheduleByProductNo('T1'))[0].fhinmei).toBe('v2');
    await store.promoteStaging('schedule');
    expect(await store.listScheduleByProductNo('T1')).toEqual([]);
    expect((await store.versions()).schedule).toEqual(v3);
    expect(await store.stagingState('schedule')).toBeUndefined();
  });
});
