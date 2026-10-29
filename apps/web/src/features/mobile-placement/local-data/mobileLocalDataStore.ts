import { enrichLocalPurchaseRows, snapNativeSlip, unpackBasePurchase, unpackPlacement, unpackPurchase, unpackSchedule, verifySlipMatch } from '@raspi-system/slip-match-core';
import { openDB } from 'idb';

import type { DatasetVersion, LocalPlacementRow, LocalPurchaseRow, MobileDataVersions, ProductionScheduleLookupRow,
  PlacementsSnapshot, MobilePurchaseSnapshot, PurchaseEnrichmentSnapshot, ScheduleSnapshot, SlipPairMatchInput } from '@raspi-system/slip-match-core';
import type { DBSchema, IDBPDatabase } from 'idb';

type PurchaseRecord = LocalPurchaseRow & { ordinal: number };
type ScheduleRecord = ProductionScheduleLookupRow & { ordinal: number };
type PurchaseVersion = DatasetVersion & { format?: 2 };
type Versions = Partial<MobileDataVersions> & { purchase?: PurchaseVersion };
type Replacement = { purchase?: MobilePurchaseSnapshot; purchaseEnrichment?: PurchaseEnrichmentSnapshot; schedule?: ScheduleSnapshot; placements?: PlacementsSnapshot };
interface LocalDb extends DBSchema {
  purchaseEnrichment: { key: string; value: PurchaseEnrichmentSnapshot };
  known: { key: string; value: string[] };
  metadata: { key: keyof MobileDataVersions; value: PurchaseVersion };
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
  function db() {
    dbPromise ??= typeof indexedDB === 'undefined' ? Promise.resolve(null) : openDB<LocalDb>(name, 3, {
      upgrade(database, oldVersion) {
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
      },
      // A newer build upgrading the schema must not wait on this tab; reopen on the next read.
      blocking() { const current = dbPromise; dbPromise = undefined; void current?.then((database) => database?.close()); }
    }).catch(() => null);
    return dbPromise;
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
      return database ? database.getAll('placements') : [...placements.values()].map((row) => ({ ...row }));
    },
    async listPlacementsByManufacturingOrder(order: string): Promise<LocalPlacementRow[]> {
      if (readDisabled) return [];
      const database = await db();
      return database ? database.getAllFromIndex('placements', 'manufacturingOrderBarcodeRaw', order)
        : [...placements.values()].filter((row) => row.manufacturingOrderBarcodeRaw === order).map((row) => ({ ...row }));
    },
    async listScheduleByProductNo(order: string): Promise<ProductionScheduleLookupRow[]> {
      if (readDisabled) return [];
      const database = await db();
      return database ? ordered(await database.getAllFromIndex('schedule', 'productNo', order)) : productNo.get(order) ?? [];
    },
    async removePlacement(id: string) {
      const database = await db();
      if (database) await database.delete('placements', id); else placements.delete(id);
      notify();
    },
    async restorePlacement(row: LocalPlacementRow) {
      const database = await db();
      if (database) {
        const tx = database.transaction('placements', 'readwrite');
        if (!await tx.store.get(row.id)) await tx.store.put(row);
        await tx.done;
      } else if (!placements.has(row.id)) placements.set(row.id, { ...row });
      notify();
    },
    async versions(): Promise<Versions> {
      const database = await db();
      if (!database) return { ...versions };
      const tx = database.transaction('metadata');
      const [p, s, b, e] = await Promise.all([tx.store.get('purchase'), tx.store.get('schedule'), tx.store.get('placements'), tx.store.get('purchaseEnrichment')]);
      return { ...(p ? { purchase: p } : {}), ...(s ? { schedule: s } : {}), ...(b ? { placements: b } : {}), ...(e ? { purchaseEnrichment: e } : {}) };
    },
    async replace(next: Replacement) {
      const database = await db();
      if (database) {
        // Clear, rows and version commit together. Abort leaves the entire previous snapshot intact.
        const tx = database.transaction(['metadata', 'purchase', 'schedule', 'known', 'placements', 'purchaseEnrichment'], 'readwrite');
        let aborted = false;
        tx.addEventListener('abort', () => { aborted = true; }, { once: true });
        // Observe rejection immediately, even if a request fails before we await done.
        const completed = tx.done.then(() => true, () => false);
        try {
          for (const kind of ['purchase', 'schedule', 'placements'] as const) {
            const snapshot = next[kind];
            if (!snapshot) continue;
            await tx.objectStore(kind).clear();
            // Await bounded batches so 225k IDB requests are never queued at once.
            for (let offset = 0; offset < snapshot.rows.length; offset += 1000) {
              if (kind === 'purchase' && next.purchase) {
                const rows = 'format' in next.purchase
                  ? next.purchase.rows.slice(offset, offset + 1000).map(unpackBasePurchase)
                  : next.purchase.rows.slice(offset, offset + 1000).map(unpackPurchase);
                await Promise.all(rows.map((row, i) => tx.objectStore('purchase').put({ ...row, ordinal: offset + i })));
              } else if (kind === 'placements' && next.placements) {
                await Promise.all(next.placements.rows.slice(offset, offset + 1000).map((row) =>
                  tx.objectStore('placements').put(unpackPlacement(row))));
              } else if (kind === 'schedule' && next.schedule) {
                await Promise.all(next.schedule.rows.slice(offset, offset + 1000).map((row, i) =>
                  tx.objectStore('schedule').put({ ...unpackSchedule(row), ordinal: offset + i })));
              }
            }
            await tx.objectStore('metadata').put({ version: snapshot.version, dataUpdatedAt: snapshot.dataUpdatedAt, ...('format' in snapshot ? { format: snapshot.format } : {}) }, kind);
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
        } catch (error) {
          let abortRequested = false;
          try { tx.abort(); abortRequested = true; } catch { /* May already be aborted or committed. */ }
          const committed = await completed;
          if (committed || (!abortRequested && !aborted)) readDisabled = true;
          throw error;
        }
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
        const tx = database.transaction(['metadata', 'purchase', 'purchaseEnrichment']);
        const [meta, enrichmentMeta, rows] = await Promise.all([tx.objectStore('metadata').get('purchase'),
          tx.objectStore('metadata').get('purchaseEnrichment'), tx.objectStore('purchase').index('purchaseOrderNo').getAll(order)]);
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
          const tx = database.transaction(['metadata', 'purchase', 'schedule']);
          const [pm, sm, tr, ar, fr, pr] = await Promise.all([
            tx.objectStore('metadata').get('purchase'), tx.objectStore('metadata').get('schedule'),
            tx.objectStore('schedule').index('productNo').getAll(transfer),
            tx.objectStore('schedule').index('productNo').getAll(actual),
            tx.objectStore('schedule').index('fseiban').getAll(seiban),
            tx.objectStore('purchase').index('purchaseOrderNo').getAll(actual)
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
