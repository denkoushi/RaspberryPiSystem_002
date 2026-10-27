import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { packPurchase, packSchedule } from '@raspi-system/slip-match-core';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { listAllScheduleLookupRows, listKnownScheduleFseibans } from '../production-schedule/production-schedule-lookup.service.js';
import { enrichPurchaseOrderLookupRows } from '../purchase-order-lookup/purchase-order-lookup-query.service.js';

import type { DatasetVersion, MobileDataVersions, PurchaseTuple } from '@raspi-system/slip-match-core';

type Stamp = { _count: number; _max: { updatedAt: Date | null; createdAt: Date | null } };
function version(stamps: Stamp[]): DatasetVersion {
  const dates = stamps.flatMap((s) => [s._max.updatedAt, s._max.createdAt]).filter((d): d is Date => d !== null);
  return {
    version: createHash('sha256').update(`mobile-v1:${JSON.stringify(stamps)}`).digest('hex'),
    dataUpdatedAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null
  };
}

async function readMobileDataVersions(): Promise<MobileDataVersions> {
  const aggregate = { _count: true, _max: { updatedAt: true, createdAt: true } } as const;
  const [purchase, schedule, dates, machines] = await Promise.all([
    prisma.purchaseOrderLookupRow.aggregate(aggregate),
    prisma.csvDashboardRow.aggregate({ ...aggregate, where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } }),
    prisma.productionScheduleOrderSupplement.aggregate({ ...aggregate, where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } }),
    prisma.productionScheduleSeibanMachineNameSupplement.aggregate(aggregate)
  ]);
  return { purchase: version([purchase, schedule, dates, machines]), schedule: version([schedule]) };
}

let cachedVersions: { value: MobileDataVersions; expiresAt: number } | undefined;
let pendingVersions: Promise<MobileDataVersions> | undefined;
export async function getMobileDataVersions(forceRefresh = false): Promise<MobileDataVersions> {
  if (!forceRefresh && cachedVersions && Date.now() < cachedVersions.expiresAt) return cachedVersions.value;
  if (!forceRefresh && pendingVersions) return pendingVersions;
  const work = readMobileDataVersions().then((value) => {
    cachedVersions = { value, expiresAt: Date.now() + 30_000 };
    return value;
  });
  pendingVersions = work;
  try { return await work; } finally { if (pendingVersions === work) pendingVersions = undefined; }
}

export type MobileDataset = keyof MobileDataVersions;
export type CachedMobileData = DatasetVersion & { jsonBytes: number; gzip: Buffer; rowCount: number; buildMs: number };
const zip = promisify(gzip);

// One completed snapshot and one in-flight build per dataset, shared across clients.
export function createMobileDataCache(
  versions = getMobileDataVersions,
  build = buildMobileData
) {
  const cache: Partial<Record<MobileDataset, CachedMobileData>> = {};
  const pending: Partial<Record<MobileDataset, Promise<CachedMobileData>>> = {};
  return async (kind: MobileDataset, current?: DatasetVersion): Promise<CachedMobileData> => {
    current ??= (await versions())[kind];
    if (cache[kind]?.version === current.version) return cache[kind]!;
    if (pending[kind]) return pending[kind]!;
    const work = (async () => {
      const started = Date.now();
      const data = await build(kind);
      // Never publish rows read across an import/update as a completed version.
      if ((await versions(true))[kind].version !== current.version) throw new Error('Mobile data changed during snapshot build');
      const json = Buffer.from(JSON.stringify({ ...current, ...data }));
      const compressed = await zip(json);
      const result = { ...current, jsonBytes: json.length, gzip: compressed, rowCount: data.rows.length, buildMs: Date.now() - started };
      cache[kind] = result;
      return result;
    })();
    pending[kind] = work;
    try { return await work; } finally { delete pending[kind]; }
  };
}

async function buildMobileData(kind: MobileDataset) {
  if (kind === 'schedule') {
    const [rows, knownFseibans] = await Promise.all([listAllScheduleLookupRows(), listKnownScheduleFseibans()]);
    return { rows: rows.map(packSchedule), knownFseibans };
  }
  const packed: PurchaseTuple[] = [];
  let cursor: string | undefined;
  // Fetch and enrich one page at a time; only packed tuples survive into the next page.
  for (;;) {
    const batch = await prisma.purchaseOrderLookupRow.findMany({
      orderBy: [{ lineIndex: 'asc' }, { id: 'asc' }], take: 5000,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {})
    });
    if (!batch.length) break;
    const enriched = await enrichPurchaseOrderLookupRows(batch);
    enriched.forEach((row, index) => packed.push(packPurchase({ ...row,
      purchaseOrderNo: batch[index].purchaseOrderNo, purchasePartCodeMatchKey: batch[index].purchasePartCodeMatchKey })));
    if (batch.length < 5000) break;
    cursor = batch[batch.length - 1].id;
  }
  return { rows: packed };
}

export const getMobileDataSnapshot = createMobileDataCache();
