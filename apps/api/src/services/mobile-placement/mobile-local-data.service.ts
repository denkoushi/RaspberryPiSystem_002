import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { packBasePurchase, packPlacement, packPurchase, packSchedule } from '@raspi-system/slip-match-core';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { listAllScheduleLookupRows, listKnownScheduleFseibans } from '../production-schedule/production-schedule-lookup.service.js';
import { enrichPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';

import { buildMobilePurchaseEnrichment } from './mobile-purchase-enrichment.service.js';

import { resolvePartSearchMachineNames } from './part-search/part-search-machine-name-fseibans.service.js';

import type { BasePurchaseTuple, DatasetVersion, MobileDataVersions, PurchaseTuple } from '@raspi-system/slip-match-core';

type ServerMobileDataVersions = Omit<MobileDataVersions, 'paged'> & { purchaseEnrichment: DatasetVersion; legacyPurchase: DatasetVersion };

type Stamp = { _count: number; _max: { updatedAt: Date | null; createdAt: Date | null }; checksum?: string };
function version(stamps: Stamp[]): DatasetVersion {
  const dates = stamps.flatMap((s) => [s._max.updatedAt, s._max.createdAt]).filter((d): d is Date => d !== null);
  return {
    version: createHash('sha256').update(`mobile-v1:${JSON.stringify(stamps)}`).digest('hex'),
    dataUpdatedAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null
  };
}

async function readMobileDataVersions(): Promise<ServerMobileDataVersions> {
  const aggregate = { _count: true, _max: { updatedAt: true, createdAt: true } } as const;
  const [purchase, schedule, dates, machines, progress, externalCompletion, placements] = await Promise.all([
    prisma.purchaseOrderLookupRow.aggregate(aggregate),
    prisma.csvDashboardRow.aggregate({ ...aggregate, where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } }),
    prisma.productionScheduleOrderSupplement.aggregate({ ...aggregate, where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } }),
    prisma.productionScheduleSeibanMachineNameSupplement.aggregate(aggregate),
    prisma.productionScheduleProgress.aggregate({ ...aggregate, where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } }),
    prisma.productionScheduleExternalCompletion.aggregate({ ...aggregate, where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } }),
    prisma.$queryRaw<{ count: number; updatedAt: Date | null; createdAt: Date | null; checksum: string }[]>`
      SELECT COUNT(*)::int AS "count", MAX("updatedAt") AS "updatedAt", MAX("createdAt") AS "createdAt",
        MD5(COALESCE(STRING_AGG("id" || ':' || "updatedAt"::text, ',' ORDER BY "id"), '')) AS "checksum"
      FROM "OrderPlacementBranchState"
    `
  ]);
  return { purchase: version([purchase]), purchaseEnrichment: version([schedule, dates, machines, progress, externalCompletion]),
    legacyPurchase: version([purchase, schedule, dates, machines, progress, externalCompletion]), schedule: version([schedule]),
    placements: version([{ _count: placements[0].count,
      _max: { updatedAt: placements[0].updatedAt, createdAt: placements[0].createdAt }, checksum: placements[0].checksum }, schedule, machines]) };
}

let cachedVersions: { value: ServerMobileDataVersions; expiresAt: number } | undefined;
let pendingVersions: Promise<ServerMobileDataVersions> | undefined;
let versionsGeneration = 0;
export function invalidateMobileDataVersions() {
  ++versionsGeneration;
  cachedVersions = undefined;
  pendingVersions = undefined;
}
export async function getMobileDataVersions(forceRefresh = false): Promise<ServerMobileDataVersions> {
  if (!forceRefresh && cachedVersions && Date.now() < cachedVersions.expiresAt) return cachedVersions.value;
  if (!forceRefresh && pendingVersions) return pendingVersions;
  const generation = versionsGeneration;
  const work = readMobileDataVersions().then((value) => {
    if (generation === versionsGeneration) cachedVersions = { value, expiresAt: Date.now() + 30_000 };
    return value;
  });
  pendingVersions = work;
  try { return await work; } finally { if (pendingVersions === work) pendingVersions = undefined; }
}

export type MobileDataset = keyof ServerMobileDataVersions;
export type CachedMobileData = DatasetVersion & { jsonBytes: number; gzip: Buffer; rowCount: number; buildMs: number;
  pages: { gzip: Buffer; jsonBytes: number }[]; pageSize: number };
export class MobileDataVersionChangedError extends Error {
  constructor() { super('Mobile data changed during snapshot build'); }
}
const zip = promisify(gzip);

// One completed snapshot and one in-flight build per dataset, shared across clients.
export function createMobileDataCache(
  versions = getMobileDataVersions,
  build = buildMobileData
) {
  const cache: Partial<Record<MobileDataset, CachedMobileData>> = {};
  const pending: Partial<Record<MobileDataset, Promise<CachedMobileData>>> = {};
  return async function snapshot(kind: MobileDataset, current?: DatasetVersion): Promise<CachedMobileData> {
    current ??= (await versions())[kind];
    if (cache[kind]?.version === current.version) return cache[kind]!;
    if (pending[kind]) {
      const result = await pending[kind]!;
      return result.version === current.version ? result : snapshot(kind, current);
    }
    const work = (async () => {
      const started = Date.now();
      const data = await build(kind);
      // Never publish rows read across an import/update as a completed version.
      if ((await versions(true))[kind].version !== current.version) throw new MobileDataVersionChangedError();
      const json = Buffer.from(JSON.stringify({ ...current, ...data }));
      const compressed = await zip(json);
      // Fixed boundaries for this version, regardless of the client's pageSize hint.
      const pageSize = Math.max(5000, Math.ceil(data.rows.length / 20));
      const pages: CachedMobileData['pages'] = [];
      if (kind !== 'purchaseEnrichment' && kind !== 'legacyPurchase') {
        const pageCount = Math.max(1, Math.ceil(data.rows.length / pageSize));
        for (let page = 1; page <= pageCount; page++) {
          const pageJson = Buffer.from(JSON.stringify({ ...current,
            ...('format' in data ? { format: data.format } : {}), page, pageCount, pageSize,
            rows: data.rows.slice((page - 1) * pageSize, page * pageSize),
            ...(page === 1 && 'knownFseibans' in data ? { knownFseibans: data.knownFseibans } : {}) }));
          pages.push({ gzip: await zip(pageJson), jsonBytes: pageJson.length });
        }
      }
      const result = { ...current, jsonBytes: json.length, gzip: compressed, rowCount: data.rows.length,
        pages, pageSize, buildMs: Date.now() - started };
      cache[kind] = result;
      return result;
    })();
    pending[kind] = work;
    try { return await work; } finally { delete pending[kind]; }
  };
}

async function buildMobileData(kind: MobileDataset) {
  if (kind === 'purchaseEnrichment') return buildMobilePurchaseEnrichment();
  if (kind === 'placements') {
    // Full snapshots by version: branch deletes have no tombstones, so a since-diff would retain deleted rows.
    const rows = await prisma.orderPlacementBranchState.findMany({ orderBy: { id: 'asc' }, select: {
      id: true, manufacturingOrderBarcodeRaw: true, branchNo: true, shelfCodeRaw: true, updatedAt: true, scheduleSnapshot: true
    } });
    const field = (snapshot: unknown, key: string): string => {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '';
      const value = (snapshot as Record<string, unknown>)[key];
      return typeof value === 'string' ? value.trim() : '';
    };
    const names = await resolvePartSearchMachineNames(rows.map((row) => field(row.scheduleSnapshot, 'FSEIBAN')));
    // Same display normalization as web normalizeMachineName, retaining the full name (no search kana folding).
    const displayName = (name: string) => name.trim().replace(/[！-～]/g,
      (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ').toUpperCase();
    return { rows: rows.map((row) => {
      const fseiban = field(row.scheduleSnapshot, 'FSEIBAN');
      return packPlacement({ id: row.id, manufacturingOrderBarcodeRaw: row.manufacturingOrderBarcodeRaw,
        branchNo: row.branchNo, shelfCodeRaw: row.shelfCodeRaw, updatedAt: row.updatedAt.toISOString(), fseiban,
        fhincd: field(row.scheduleSnapshot, 'FHINCD'), fhinmei: field(row.scheduleSnapshot, 'FHINMEI'),
        productNo: field(row.scheduleSnapshot, 'ProductNo'), machineName: displayName(names.get(fseiban) ?? '') });
    }) };
  }
  if (kind === 'schedule') {
    const [rows, knownFseibans] = await Promise.all([listAllScheduleLookupRows(), listKnownScheduleFseibans()]);
    return { rows: rows.map(packSchedule), knownFseibans };
  }
  const packed: PurchaseTuple[] = [];
  const base: BasePurchaseTuple[] = [];
  let cursor: string | undefined;
  // Fetch and enrich one page at a time; only packed tuples survive into the next page.
  for (;;) {
    const batch = await prisma.purchaseOrderLookupRow.findMany({
      orderBy: [{ lineIndex: 'asc' }, { id: 'asc' }], take: 5000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (!batch.length) break;
    if (kind === 'purchase') {
      batch.forEach((row) => base.push(packBasePurchase(row)));
    } else {
      const enriched = await enrichPurchaseOrderLookupRows(batch);
      enriched.forEach((row, index) => packed.push(packPurchase({ ...row,
        purchaseOrderNo: batch[index].purchaseOrderNo, purchasePartCodeMatchKey: batch[index].purchasePartCodeMatchKey })));
    }
    if (batch.length < 5000) break;
    cursor = batch[batch.length - 1].id;
  }
  return kind === 'purchase' ? { format: 2 as const, rows: base } : { rows: packed };
}

export const getMobileDataSnapshot = createMobileDataCache();
