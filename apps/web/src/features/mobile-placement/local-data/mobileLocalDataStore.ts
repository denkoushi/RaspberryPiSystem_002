import { enrichLocalPurchaseRows, snapNativeSlip, unpackBasePurchase, unpackPlacement, unpackPurchase, unpackSchedule, verifySlipMatch } from '@raspi-system/slip-match-core';
import { openDB } from 'idb';

import type { DatasetVersion, LocalPlacementRow, LocalPurchaseRow, MobileDataVersions, ProductionScheduleLookupRow,
  BasePurchaseTuple, PlacementTuple, ScheduleTuple, PlacementsSnapshot, MobilePurchaseSnapshot, PurchaseEnrichmentSnapshot, ScheduleSnapshot, SlipPairMatchInput } from '@raspi-system/slip-match-core';
import type { DBSchema, IDBPDatabase } from 'idb';

type PurchaseRecord = LocalPurchaseRow & { ordinal: number };
type ScheduleRecord = ProductionScheduleLookupRow & { ordinal: number };
type PurchaseVersion = DatasetVersion & { format?: 2 };
export type PagedDataset = 'purchase' | 'schedule' | 'placements';
type StagingState = PurchaseVersion & { nextPage: number; pageCount: number; pageSize: number; knownFseibans?: string[] };
type StagingRow = BasePurchaseTuple | ScheduleTuple | PlacementTuple;
const stagingStores = { purchase: 'stagingPurchase', schedule: 'stagingSchedule', placements: 'stagingPlacements' } as const;
type PhysicalStore = PagedDataset | typeof stagingStores[PagedDataset];
type LivePointer = { liveStore: PhysicalStore };
type Versions = Partial<MobileDataVersions> & { purchase?: PurchaseVersion };
type Replacement = { purchase?: MobilePurchaseSnapshot; purchaseEnrichment?: PurchaseEnrichmentSnapshot; schedule?: ScheduleSnapshot; placements?: PlacementsSnapshot };
interface LocalDb extends DBSchema {
  purchaseEnrichment: { key: string; value: PurchaseEnrichmentSnapshot };
  known: { key: string; value: string[] };
  metadata: { key: PagedDataset | 'purchaseEnrichment' | `staging:${PagedDataset}` | `live:${PagedDataset}`; value: PurchaseVersion | LivePointer };
  stagingPurchase: { key: number; value: PurchaseRecord; indexes: { purchaseOrderNo: string } };
  stagingSchedule: { key: number; value: ScheduleRecord; indexes: { productNo: string; fseiban: string } };
  stagingPlacements: { key: string; value: LocalPlacementRow; indexes: { manufacturingOrderBarcodeRaw: string } };
  placements: { key: string; value: LocalPlacementRow; indexes: { manufacturingOrderBarcodeRaw: string } };
  purchase: { key: number; value: PurchaseRecord; indexes: { purchaseOrderNo: string } };
  schedule: { key: number; value: ScheduleRecord; indexes: { productNo: string; fseiban: string } };
}
const ordered = <T extends { ordinal: number }>(rows: T[]) => rows.sort((a, b) => a.ordinal - b.ordinal);

export function createMobileLocalDataStore(name = 'mobile-local-data-v1') {
  let dbPromise: Promise<IDBPDatabase<LocalDb> | null> | undefined;
  const versions: Versions = {};
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  let placements = new Map<string, LocalPlacementRow>();
  let purchaseEnrichment: PurchaseEnrichmentSnapshot | undefined;
  let enrichmentCache: PurchaseEnrichmentSnapshot | undefined;
  let purchase = new Map<string, PurchaseRecord[]>();
  let productNo = new Map<string, ScheduleRecord[]>();
  let fseiban = new Map<string, ScheduleRecord[]>();
  let readDisabled = false;
  let knownFseibans: string[] = [];
  const staging = new Map<PagedDataset, { state: StagingState; rows: StagingRow[] }>();
  const liveStores = { purchase: 'purchase', schedule: 'schedule', placements: 'placements' } as {
    [K in PagedDataset]: K | typeof stagingStores[K]
  };
  let pointerUpdate = Promise.resolve();
  function setLiveStore<K extends PagedDataset>(kind: K, store: typeof liveStores[K]) { liveStores[kind] = store; }
  function inactiveStore<K extends PagedDataset>(kind: K): K | typeof stagingStores[K] {
    return liveStores[kind] === kind ? stagingStores[kind] : kind;
  }
  async function refreshPointers(database: IDBPDatabase<LocalDb>) {
    const tx = database.transaction('metadata');
    const kinds = ['purchase', 'schedule', 'placements'] as const;
    const pointers = await Promise.all(kinds.map((kind) => tx.store.get(`live:${kind}`) as Promise<LivePointer | undefined>));
    kinds.forEach((kind, i) => {
      // Absent pointers are existing installs, whose original stores remain live.
      setLiveStore(kind, pointers[i]?.liveStore === stagingStores[kind] ? stagingStores[kind] : kind);
    });
  }
  async function db(waitForPointer = true) {
    dbPromise ??= typeof indexedDB === 'undefined' ? Promise.resolve(null) : openDB<LocalDb>(name, 5, {
      upgrade(database, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          database.createObjectStore('metadata');
          database.createObjectStore('known');
          database.createObjectStore('purchase', { keyPath: 'ordinal' }).createIndex('purchaseOrderNo', 'purchaseOrderNo');
          const schedule = database.createObjectStore('schedule', { keyPath: 'ordinal' });
          schedule.createIndex('productNo', 'productNo'); schedule.createIndex('fseiban', 'fseiban');
        }
        if (oldVersion < 2) {
          database.createObjectStore('placements', { keyPath: 'id' })
            .createIndex('manufacturingOrderBarcodeRaw', 'manufacturingOrderBarcodeRaw');
        }
        if (oldVersion < 3) {
          // Legacy joined rows stay readable until sync swaps in the independent format.
          database.createObjectStore('purchaseEnrichment');
        }
        if (oldVersion < 4) {
          database.createObjectStore('stagingPurchase', { keyPath: 'ordinal' });
          database.createObjectStore('stagingSchedule', { keyPath: 'ordinal' });
          database.createObjectStore('stagingPlacements', { keyPath: 'id' });
        }
        if (oldVersion < 5) {
          // Staging is re-downloadable; indexing 100k staged rows here would stall the upgrade on phones.
          for (const kind of ['purchase', 'schedule', 'placements'] as const) {
            void tx.objectStore(stagingStores[kind]).clear();
            void tx.objectStore('metadata').delete(`staging:${kind}`);
          }
          tx.objectStore('stagingPurchase').createIndex('purchaseOrderNo', 'purchaseOrderNo');
          tx.objectStore('stagingSchedule').createIndex('productNo', 'productNo');
          tx.objectStore('stagingSchedule').createIndex('fseiban', 'fseiban');
          tx.objectStore('stagingPlacements').createIndex('manufacturingOrderBarcodeRaw', 'manufacturingOrderBarcodeRaw');
        }
      },
      // A newer build upgrading the schema must not wait on this tab; reopen on the next read.
      blocking() { const current = dbPromise; dbPromise = undefined; void current?.then((database) => database?.close()); }
    }).then(async (database) => {
      try { await refreshPointers(database); } catch {
        for (const kind of ['purchase', 'schedule', 'placements'] as const) setLiveStore(kind, kind);
      }
      return database;
    }).catch(() => null);
    const database = await dbPromise;
    if (waitForPointer) await pointerUpdate;
    // Another tab or store instance may have flipped a buffer since this one cached its pointers.
    if (database) await refreshPointers(database).catch(() => undefined);
    return database;
  }
  function index<T>(rows: T[], key: (row: T) => string) {
    const map = new Map<string, T[]>();
    rows.forEach((row) => { const k = key(row); const group = map.get(k); if (group) group.push(row); else map.set(k, [row]); });
    return map;
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async listPlacements(): Promise<LocalPlacementRow[]> {
      if (readDisabled) return [];
      const database = await db();
      return database ? database.getAll(liveStores.placements) : [...placements.values()].map((row) => ({ ...row }));
    },
    async listPlacementsByManufacturingOrder(order: string): Promise<LocalPlacementRow[]> {
      if (readDisabled) return [];
      const database = await db();
      return database ? database.getAllFromIndex(liveStores.placements, 'manufacturingOrderBarcodeRaw', order)
        : [...placements.values()].filter((row) => row.manufacturingOrderBarcodeRaw === order).map((row) => ({ ...row }));
    },
    async listScheduleByProductNo(order: string): Promise<ProductionScheduleLookupRow[]> {
      if (readDisabled) return [];
      const database = await db();
      return database ? ordered(await database.getAllFromIndex(liveStores.schedule, 'productNo', order)) : productNo.get(order) ?? [];
    },
    async removePlacement(id: string) {
      const database = await db();
      if (database) await database.delete(liveStores.placements, id); else placements.delete(id);
      notify();
    },
    async restorePlacement(row: LocalPlacementRow) {
      const database = await db();
      if (database) {
        const tx = database.transaction(liveStores.placements, 'readwrite');
        if (!await tx.store.get(row.id)) await tx.store.put(row);
        await tx.done;
      } else if (!placements.has(row.id)) placements.set(row.id, { ...row });
      notify();
    },
    async versions(): Promise<Versions> {
      const database = await db();
      if (!database) return { ...versions };
      const tx = database.transaction('metadata');
      const [p, s, b, e] = await Promise.all([tx.store.get('purchase') as Promise<PurchaseVersion | undefined>, tx.store.get('schedule') as Promise<PurchaseVersion | undefined>, tx.store.get('placements') as Promise<PurchaseVersion | undefined>, tx.store.get('purchaseEnrichment') as Promise<PurchaseVersion | undefined>]);
      return { ...(p ? { purchase: p } : {}), ...(s ? { schedule: s } : {}), ...(b ? { placements: b } : {}), ...(e ? { purchaseEnrichment: e } : {}) };
    },
    async stagingState(kind: PagedDataset): Promise<StagingState | undefined> {
      const database = await db();
      return database ? await database.get('metadata', `staging:${kind}`) as StagingState | undefined : staging.get(kind)?.state;
    },
    async discardStaging(kind: PagedDataset) {
      const database = await db();
      if (!database) { staging.delete(kind); return; }
      const target = inactiveStore(kind);
      const stateTx = database.transaction('metadata', 'readwrite');
      await Promise.all([stateTx.store.delete(`staging:${kind}`), stateTx.done]);
      const tx = database.transaction(target, 'readwrite');
      await Promise.all([tx.store.clear(), tx.done]);
      await refreshPointers(database);
    },
    async writeStagingPage(kind: PagedDataset, version: PurchaseVersion, page: number, pageCount: number,
      rows: StagingRow[], pageSize: number, known?: string[]) {
      if (!Number.isInteger(page) || !Number.isInteger(pageCount) || !Number.isInteger(pageSize) ||
          page < 1 || page > pageCount || pageCount > 20 || pageSize < 1 || rows.length > pageSize ||
          page < pageCount && rows.length !== pageSize || kind === 'purchase' && version.format !== 2 ||
          kind === 'schedule' && page === 1 && !known) throw new Error('Invalid mobile staging page');
      const nextState = (previous?: StagingState): StagingState => {
        const same = previous?.version === version.version && previous.pageSize === pageSize &&
          previous.pageCount === pageCount && previous.format === version.format;
        if ((!same && page !== 1) || (same && page > previous.nextPage)) throw new Error('Mobile staging page out of order');
        return { version: version.version, dataUpdatedAt: version.dataUpdatedAt,
          ...(version.format === 2 ? { format: version.format } : {}),
          pageCount, pageSize, nextPage: Math.max(same ? previous.nextPage : 1, page + 1),
          ...(kind === 'schedule' ? { knownFseibans: page === 1 ? known : previous?.knownFseibans } : {}) };
      };
      const database = await db();
      const offset = (page - 1) * pageSize;
      if (!database) {
        const previous = staging.get(kind);
        const state = nextState(previous?.state);
        const values = previous?.state.version === version.version && previous.state.pageSize === pageSize &&
          previous.state.pageCount === pageCount && previous.state.format === version.format ? [...previous.rows] : [];
        rows.forEach((row, i) => { values[offset + i] = row; });
        staging.set(kind, { state, rows: values });
        return;
      }
      const target = inactiveStore(kind);
      const previous = await database.get('metadata', `staging:${kind}`) as StagingState | undefined;
      const state = nextState(previous);
      const tx = database.transaction(target, 'readwrite');
      const completed = tx.done.catch(() => {});
      try {
        if (!previous || previous.version !== version.version || previous.pageSize !== pageSize ||
            previous.pageCount !== pageCount || previous.format !== version.format) await tx.objectStore(target).clear();
        for (let start = 0; start < rows.length; start += 1000) {
          await Promise.all(rows.slice(start, start + 1000).map((row, i) => {
            const ordinal = offset + start + i;
            const value = kind === 'purchase' ? { ...unpackBasePurchase(row as BasePurchaseTuple), ordinal }
              : kind === 'schedule' ? { ...unpackSchedule(row as ScheduleTuple), ordinal } : unpackPlacement(row as PlacementTuple);
            return tx.objectStore(target).put(value);
          }));
        }
        await tx.done;
      } catch (error) {
        try { tx.abort(); } catch { /* Already aborted or committed. */ }
        await completed;
        throw error;
      }
      const stateTx = database.transaction('metadata', 'readwrite');
      await Promise.all([stateTx.store.put(state, `staging:${kind}`), stateTx.done]);
    },
    async promoteStaging(kind: PagedDataset) {
      const previousUpdate = pointerUpdate;
      let releasePointer!: () => void;
      // Reserve the flip before yielding, so concurrent reads wait for the committed pointer.
      pointerUpdate = new Promise<void>((resolve) => { releasePointer = resolve; });
      try {
        await previousUpdate;
        const database = await db(false);
        if (!database) {
          const staged = staging.get(kind);
          if (!staged || staged.state.nextPage !== staged.state.pageCount + 1) throw new Error('Mobile staging incomplete');
          if (kind === 'purchase') {
            purchase = index(staged.rows.map((row, ordinal) => ({ ...unpackBasePurchase(row as BasePurchaseTuple), ordinal })), (row) => row.purchaseOrderNo);
          } else if (kind === 'schedule') {
            const rows = staged.rows.map((row, ordinal) => ({ ...unpackSchedule(row as ScheduleTuple), ordinal }));
            productNo = index(rows, (row) => row.productNo); fseiban = index(rows, (row) => row.fseiban);
            knownFseibans = staged.state.knownFseibans!;
          } else {
            placements = new Map(staged.rows.map((row) => { const value = unpackPlacement(row as PlacementTuple); return [value.id, value]; }));
          }
          const { version, dataUpdatedAt, format } = staged.state;
          versions[kind] = { version, dataUpdatedAt, ...(format === 2 ? { format } : {}) };
          staging.delete(kind);
        } else {
          const target = inactiveStore(kind);
          const tx = database.transaction(kind === 'schedule' ? ['metadata', 'known'] : ['metadata'], 'readwrite');
          let aborted = false;
          tx.addEventListener('abort', () => { aborted = true; }, { once: true });
          const completed = tx.done.then(() => true, () => false);
          try {
            const state = await tx.objectStore('metadata').get(`staging:${kind}`) as StagingState | undefined;
            if (!state || state.nextPage !== state.pageCount + 1) throw new Error('Mobile staging incomplete');
            await tx.objectStore('metadata').put({ liveStore: target }, `live:${kind}`);
            if (kind === 'schedule') await tx.objectStore('known').put(state.knownFseibans!, 'fseibans');
            const { version, dataUpdatedAt, format } = state;
            await tx.objectStore('metadata').put({ version, dataUpdatedAt, ...(format === 2 ? { format } : {}) }, kind);
            await tx.objectStore('metadata').delete(`staging:${kind}`);
            await tx.done;
            setLiveStore(kind, target);
          } catch (error) {
            let abortRequested = false;
            try { tx.abort(); abortRequested = true; } catch { /* Already aborted or committed. */ }
            const committed = await completed;
            if (committed || (!abortRequested && !aborted)) readDisabled = true;
            throw error;
          }
        }
        readDisabled = false;
        notify();
      } finally { releasePointer(); }
    },
    async replace(next: Replacement) {
      const database = await db();
      if (database) {
        const targets = { ...liveStores };
        function setTarget<K extends PagedDataset>(kind: K, target: typeof liveStores[K]) { targets[kind] = target; }
        for (const kind of ['purchase', 'schedule', 'placements'] as const) {
          const snapshot = next[kind];
          if (!snapshot) continue;
          const target = inactiveStore(kind);
          setTarget(kind, target);
          // A full replacement supersedes paged staging. Keep the large clear off metadata.
          const stagingTx = database.transaction('metadata', 'readwrite');
          await Promise.all([stagingTx.store.delete(`staging:${kind}`), stagingTx.done]);
          const clearTx = database.transaction(target, 'readwrite');
          await Promise.all([clearTx.store.clear(), clearTx.done]);
          for (let offset = 0; offset < snapshot.rows.length; offset += 1000) {
            const rowTx = database.transaction(target, 'readwrite');
            const completed = rowTx.done.catch(() => {});
            try {
              if (kind === 'purchase' && next.purchase) {
                const rows = 'format' in next.purchase
                  ? next.purchase.rows.slice(offset, offset + 1000).map(unpackBasePurchase)
                  : next.purchase.rows.slice(offset, offset + 1000).map(unpackPurchase);
                await Promise.all(rows.map((row, i) => rowTx.objectStore(target).put({ ...row, ordinal: offset + i })));
              } else if (kind === 'placements' && next.placements) {
                await Promise.all(next.placements.rows.slice(offset, offset + 1000).map((row) =>
                  rowTx.objectStore(target).put(unpackPlacement(row))));
              } else if (kind === 'schedule' && next.schedule) {
                await Promise.all(next.schedule.rows.slice(offset, offset + 1000).map((row, i) =>
                  rowTx.objectStore(target).put({ ...unpackSchedule(row), ordinal: offset + i })));
              }
              await rowTx.done;
            } catch (error) {
              try { rowTx.abort(); } catch { /* Already aborted or committed; only the inactive buffer changed. */ }
              await completed;
              throw error;
            }
          }
        }
        const previousUpdate = pointerUpdate;
        let releasePointer!: () => void;
        pointerUpdate = new Promise<void>((resolve) => { releasePointer = resolve; });
        try {
          await previousUpdate;
          const tx = database.transaction(['metadata', 'known', 'purchaseEnrichment'], 'readwrite');
          let aborted = false;
          tx.addEventListener('abort', () => { aborted = true; }, { once: true });
          const completed = tx.done.then(() => true, () => false);
          try {
            for (const kind of ['purchase', 'schedule', 'placements'] as const) {
              const snapshot = next[kind];
              if (!snapshot) continue;
              await tx.objectStore('metadata').put({ liveStore: targets[kind] }, `live:${kind}`);
              await tx.objectStore('metadata').put({ version: snapshot.version, dataUpdatedAt: snapshot.dataUpdatedAt,
                ...('format' in snapshot ? { format: snapshot.format } : {}) }, kind);
            }
            if (next.purchase && !('format' in next.purchase)) {
              await tx.objectStore('purchaseEnrichment').clear();
              await tx.objectStore('metadata').delete('purchaseEnrichment');
            } else if (next.purchaseEnrichment) {
              await tx.objectStore('purchaseEnrichment').put(next.purchaseEnrichment, 'current');
              await tx.objectStore('metadata').put({ version: next.purchaseEnrichment.version,
                dataUpdatedAt: next.purchaseEnrichment.dataUpdatedAt }, 'purchaseEnrichment');
            }
            if (next.schedule) await tx.objectStore('known').put(next.schedule.knownFseibans, 'fseibans');
            await tx.done;
            for (const kind of ['purchase', 'schedule', 'placements'] as const) {
              if (next[kind]) setLiveStore(kind, targets[kind]);
            }
          } catch (error) {
            let abortRequested = false;
            try { tx.abort(); abortRequested = true; } catch { /* May already be aborted or committed. */ }
            const committed = await completed;
            if (committed || (!abortRequested && !aborted)) readDisabled = true;
            throw error;
          }
        } finally { releasePointer(); }
      } else {
        // Build replacements before publishing any part of the memory fallback.
        const p = next.purchase && ('format' in next.purchase
          ? next.purchase.rows.map((r, ordinal) => ({ ...unpackBasePurchase(r), ordinal }))
          : next.purchase.rows.map((r, ordinal) => ({ ...unpackPurchase(r), ordinal })));
        const s = next.schedule?.rows.map((r, ordinal) => ({ ...unpackSchedule(r), ordinal }));
        const b = next.placements ? new Map(next.placements.rows.map((r) => { const row = unpackPlacement(r); return [row.id, row]; })) : placements;
        const pIndex = p ? index(p, (r) => r.purchaseOrderNo) : purchase;
        const orderIndex = s ? index(s, (r) => r.productNo) : productNo;
        const seibanIndex = s ? index(s, (r) => r.fseiban) : fseiban;
        const nextKnownFseibans = next.schedule ? next.schedule.knownFseibans : knownFseibans;
        const nextVersions = { ...versions };
        for (const kind of ['purchase', 'schedule', 'placements', 'purchaseEnrichment'] as const) {
          const snapshot = next[kind];
          if (snapshot) nextVersions[kind] = { version: snapshot.version, dataUpdatedAt: snapshot.dataUpdatedAt, ...('format' in snapshot ? { format: snapshot.format } : {}) };
        }
        const e = next.purchase && !('format' in next.purchase) ? undefined : next.purchaseEnrichment ?? purchaseEnrichment;
        if (!e) delete nextVersions.purchaseEnrichment;
        purchaseEnrichment = e;
        placements = b;
        purchase = pIndex; productNo = orderIndex; fseiban = seibanIndex;
        knownFseibans = nextKnownFseibans;
        delete versions.purchaseEnrichment;
        Object.assign(versions, nextVersions);
        for (const kind of ['purchase', 'schedule', 'placements'] as const) if (next[kind]) staging.delete(kind);
      }
      readDisabled = false;
      notify();
    },
    async lookupPurchase(order: string) {
      if (readDisabled) return null;
      try {
        const database = await db();
        if (!database) {
          if (!versions.purchase || versions.purchase.format === 2 && !purchaseEnrichment) return null;
          const rows = purchase.get(order) ?? [];
          return { purchaseOrderNo: order, rows: versions.purchase.format === 2 ? enrichLocalPurchaseRows(rows, purchaseEnrichment!.rows) : rows };
        }
        const tx = database.transaction(['metadata', liveStores.purchase, 'purchaseEnrichment']);
        const [meta, enrichmentMeta, rows] = await Promise.all([tx.objectStore('metadata').get('purchase') as Promise<PurchaseVersion | undefined>,
          tx.objectStore('metadata').get('purchaseEnrichment') as Promise<PurchaseVersion | undefined>, tx.objectStore(liveStores.purchase).index('purchaseOrderNo').getAll(order)]);
        // The enrichment value is large; read it once per version instead of on every scan.
        if (meta?.format === 2 && enrichmentMeta && enrichmentCache?.version !== enrichmentMeta.version) {
          const value = await tx.objectStore('purchaseEnrichment').get('current');
          enrichmentCache = value?.version === enrichmentMeta.version ? value : undefined;
        }
        const enrichment = enrichmentMeta && enrichmentCache?.version === enrichmentMeta.version ? enrichmentCache : undefined;
        if (!meta || meta.format === 2 && !enrichment) return null;
        return { purchaseOrderNo: order, rows: meta.format === 2 ? enrichLocalPurchaseRows(ordered(rows), enrichment!.rows) : ordered(rows) };
      } catch { return null; }
    },
    async snapNative(tokens: string[], text: string) {
      if (readDisabled) return null;
      try {
        const database = await db();
        if (!database) return versions.schedule ? snapNativeSlip(tokens, text, knownFseibans) : null;
        const known = await database.get('known', 'fseibans');
        return known ? snapNativeSlip(tokens, text, known) : null;
      } catch { return null; }
    },
    async verify(input: SlipPairMatchInput) {
      if (readDisabled) return null;
      try {
        const database = await db();
        const transfer = input.transferOrderBarcodeRaw.trim();
        const actual = input.actualOrderBarcodeRaw.trim();
        const seiban = input.actualFseibanRaw.trim();
        let t: ScheduleRecord[], a: ScheduleRecord[], f: ScheduleRecord[], p: PurchaseRecord[];
        if (!database) {
          if (!versions.purchase || !versions.schedule) return null;
          t = productNo.get(transfer) ?? []; a = productNo.get(actual) ?? [];
          f = fseiban.get(seiban) ?? []; p = purchase.get(actual) ?? [];
        } else {
          // All lookup inputs come from one readonly transaction, including both version markers.
          const tx = database.transaction(['metadata', liveStores.purchase, liveStores.schedule]);
          const [pm, sm, tr, ar, fr, pr] = await Promise.all([
            tx.objectStore('metadata').get('purchase') as Promise<PurchaseVersion | undefined>, tx.objectStore('metadata').get('schedule') as Promise<PurchaseVersion | undefined>,
            tx.objectStore(liveStores.schedule).index('productNo').getAll(transfer),
            tx.objectStore(liveStores.schedule).index('productNo').getAll(actual),
            tx.objectStore(liveStores.schedule).index('fseiban').getAll(seiban),
            tx.objectStore(liveStores.purchase).index('purchaseOrderNo').getAll(actual)
          ]);
          if (!pm || !sm) return null;
          t = ordered(tr); a = ordered(ar); f = ordered(fr); p = ordered(pr);
        }
        return verifySlipMatch(input, {
          listScheduleRowsByProductNo: (value) => Promise.resolve(value === transfer ? t : a),
          listScheduleRowsByFseiban: () => Promise.resolve(f),
          findPurchaseOrderLookupRows: () => Promise.resolve(p)
        });
      } catch { return null; }
    }
  };
}
export type MobileLocalDataStore = ReturnType<typeof createMobileLocalDataStore>;
export const mobileLocalDataStore = createMobileLocalDataStore();
