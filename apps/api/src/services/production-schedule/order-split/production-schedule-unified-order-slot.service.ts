import { createHash } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

export type UnifiedOrderSlotExclusions = {
  excludeParentRowId?: string;
  excludeSplitId?: string;
};

export type UnifiedOrderSlotKey = {
  locationKey: string;
  resourceCd: string;
  orderNumber: number;
};

type UnifiedOrderSlotLockExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>;

export function compareUnifiedOrderSlotKeys(a: UnifiedOrderSlotKey, b: UnifiedOrderSlotKey): number {
  const locationCompare = a.locationKey.localeCompare(b.locationKey);
  if (locationCompare !== 0) return locationCompare;

  const resourceCompare = a.resourceCd.trim().localeCompare(b.resourceCd.trim());
  if (resourceCompare !== 0) return resourceCompare;

  return a.orderNumber - b.orderNumber;
}

/** 同一 transaction 内で複数 slot lock を取る前に、固定順へ正規化する。 */
export function sortUnifiedOrderSlots(slots: readonly UnifiedOrderSlotKey[]): UnifiedOrderSlotKey[] {
  const seen = new Set<string>();
  const unique: UnifiedOrderSlotKey[] = [];
  for (const slot of slots) {
    const resourceCd = slot.resourceCd.trim();
    const dedupeKey = `${slot.locationKey}\0${resourceCd}\0${slot.orderNumber}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    unique.push({
      locationKey: slot.locationKey,
      resourceCd,
      orderNumber: slot.orderNumber
    });
  }
  return unique.sort(compareUnifiedOrderSlotKeys);
}

function hashOrderSlotAdvisoryLock(params: {
  locationKey: string;
  resourceCd: string;
  orderNumber: number;
}): bigint {
  const digest = createHash('sha256')
    .update(`${params.locationKey}\0${params.resourceCd.trim()}\0${params.orderNumber}`)
    .digest();
  return digest.readBigInt64BE(0);
}

/** usage 集計と同じ scope: `location = locationKey OR siteKey = locationKey`（実装は index 向けに分離 lookup）。 */
export function buildUnifiedOrderSlotScopeWhere(
  locationKey: string
): Array<{ location: string } | { siteKey: string }> {
  const trimmed = locationKey.trim();
  return [{ location: trimmed }, { siteKey: trimmed }];
}

async function hasParentOrderSlotConflictInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    locationKey: string;
    resourceCd: string;
    orderNumber: number;
    excludeParentRowId?: string;
  }
): Promise<boolean> {
  const locationKey = params.locationKey.trim();
  const resourceCd = params.resourceCd.trim();
  const excludeParentRowId = params.excludeParentRowId
    ? { csvDashboardRowId: { not: params.excludeParentRowId } }
    : {};

  const exactLocationConflict = await tx.productionScheduleOrderAssignment.findFirst({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey,
      resourceCd,
      orderNumber: params.orderNumber,
      ...excludeParentRowId
    },
    select: { id: true }
  });
  if (exactLocationConflict) {
    return true;
  }

  const siteFallbackConflict = await tx.productionScheduleOrderAssignment.findFirst({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey: locationKey,
      resourceCd,
      orderNumber: params.orderNumber,
      ...excludeParentRowId
    },
    select: { id: true }
  });
  return siteFallbackConflict != null;
}

async function hasSplitOrderSlotConflictInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    locationKey: string;
    resourceCd: string;
    orderNumber: number;
    excludeSplitId?: string;
  }
): Promise<boolean> {
  const locationKey = params.locationKey.trim();
  const resourceCd = params.resourceCd.trim();
  const excludeSplitId = params.excludeSplitId ? { splitId: { not: params.excludeSplitId } } : {};

  const exactLocationConflict = await tx.productionScheduleOrderSplitAssignment.findFirst({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey,
      resourceCd,
      orderNumber: params.orderNumber,
      ...excludeSplitId
    },
    select: { id: true }
  });
  if (exactLocationConflict) {
    return true;
  }

  const siteFallbackConflict = await tx.productionScheduleOrderSplitAssignment.findFirst({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey: locationKey,
      resourceCd,
      orderNumber: params.orderNumber,
      ...excludeSplitId
    },
    select: { id: true }
  });
  return siteFallbackConflict != null;
}

/** device 書き込み時は site fallback と直列化するため site lock も取る。 */
export function resolveUnifiedOrderSlotLockScopeKeys(locationKey: string): string[] {
  const trimmed = locationKey.trim();
  const siteKey = resolveSiteKeyFromScopeKey(trimmed);
  if (siteKey === trimmed) {
    return [trimmed];
  }
  return [trimmed, siteKey].sort((a, b) => a.localeCompare(b));
}

/**
 * 親行 assignment と分割片 assignment が同一 (location, resourceCd, orderNumber) を
 * 取らないよう、スロット単位の advisory lock 下で両テーブルを検証する。
 */
export async function assertUnifiedOrderSlotAvailableInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    locationKey: string;
    resourceCd: string;
    orderNumber: number;
  } & UnifiedOrderSlotExclusions
): Promise<void> {
  const resourceCd = params.resourceCd.trim();

  if (
    await hasParentOrderSlotConflictInTransaction(tx, {
      locationKey: params.locationKey,
      resourceCd,
      orderNumber: params.orderNumber,
      excludeParentRowId: params.excludeParentRowId
    })
  ) {
    throw new ApiError(409, 'この番号は既に使用されています', undefined, 'ORDER_NUMBER_CONFLICT');
  }

  if (
    await hasSplitOrderSlotConflictInTransaction(tx, {
      locationKey: params.locationKey,
      resourceCd,
      orderNumber: params.orderNumber,
      excludeSplitId: params.excludeSplitId
    })
  ) {
    throw new ApiError(409, 'この番号は既に使用されています', undefined, 'ORDER_NUMBER_CONFLICT');
  }
}

async function acquireUnifiedOrderSlotLockRawInTransaction(
  tx: UnifiedOrderSlotLockExecutor,
  params: {
    locationKey: string;
    resourceCd: string;
    orderNumber: number;
  }
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hashOrderSlotAdvisoryLock(params)})`;
}

export async function acquireUnifiedOrderSlotLockInTransaction(
  tx: UnifiedOrderSlotLockExecutor,
  params: {
    locationKey: string;
    resourceCd: string;
    orderNumber: number;
  }
): Promise<void> {
  await acquireUnifiedOrderSlotLocksForScopeInTransaction(tx, params);
}

/** scope 内の全 lock key（site canonical / device fallback）を固定順で取得する。 */
export async function acquireUnifiedOrderSlotLocksForScopeInTransaction(
  tx: UnifiedOrderSlotLockExecutor,
  params: {
    locationKey: string;
    resourceCd: string;
    orderNumber: number;
  }
): Promise<void> {
  const resourceCd = params.resourceCd.trim();
  for (const locationKey of resolveUnifiedOrderSlotLockScopeKeys(params.locationKey)) {
    await acquireUnifiedOrderSlotLockRawInTransaction(tx, {
      locationKey,
      resourceCd,
      orderNumber: params.orderNumber
    });
  }
}

export async function acquireUnifiedOrderSlotLocksInTransaction(
  tx: UnifiedOrderSlotLockExecutor,
  slots: readonly UnifiedOrderSlotKey[]
): Promise<void> {
  const expanded: UnifiedOrderSlotKey[] = [];
  for (const slot of slots) {
    const resourceCd = slot.resourceCd.trim();
    for (const locationKey of resolveUnifiedOrderSlotLockScopeKeys(slot.locationKey)) {
      expanded.push({
        locationKey,
        resourceCd,
        orderNumber: slot.orderNumber
      });
    }
  }

  for (const slot of sortUnifiedOrderSlots(expanded)) {
    await acquireUnifiedOrderSlotLockRawInTransaction(tx, slot);
  }
}
