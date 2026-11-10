import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule/production-schedule-effective-completion.sql.js';
import {
  listPurchasePlannedStartCandidates,
  resolvePurchasePlannedStartCandidates,
} from '../purchase-order-lookup/purchase-order-lookup-planned-start.service.js';
import {
  normalizePurchaseFhinCdForMatching,
  normalizePurchaseFhinCdForScheduleLookup,
} from '../purchase-order-lookup/purchase-fhincd-normalize.js';

import { normalizeSlipToken } from './mobile-placement-slip-match.js';

type Placement = {
  slipKind?: string | null;
  manufacturingOrderBarcodeRaw: string;
  scheduleSnapshot: unknown;
};
type CompletionDb = Pick<Prisma.TransactionClient, '$queryRaw'>;
type ShelfCompletionDb = CompletionDb & {
  orderPlacementBranchState: Pick<Prisma.TransactionClient['orderPlacementBranchState'], 'findMany'>;
  haizenCurrentPlacement: Pick<Prisma.TransactionClient['haizenCurrentPlacement'], 'findMany'>;
};

function snapshotField(snapshot: unknown, key: string): string {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return '';
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

/** Read-only: missing schedule rows/candidates remain active. Zero2W rows are order-only. */
export async function filterActivePlacements<T extends Placement>(
  rows: T[], db: CompletionDb = prisma
): Promise<T[]> {
  const productNos = [...new Set(rows.filter(row => row.slipKind !== 'purchase_order')
    .map(row => normalizeSlipToken(row.manufacturingOrderBarcodeRaw)).filter(Boolean))];
  const purchases = rows.filter(row => row.slipKind === 'purchase_order');
  const parts = purchases.map(row => {
    const rawCode = snapshotField(row.scheduleSnapshot, 'FHINCD');
    return {
      seiban: snapshotField(row.scheduleSnapshot, 'FSEIBAN'),
      purchasePartCodeMatchKey: normalizePurchaseFhinCdForMatching(rawCode),
      purchasePartCodeNormalized: normalizePurchaseFhinCdForScheduleLookup(rawCode),
      purchasePartName: snapshotField(row.scheduleSnapshot, 'FHINMEI'),
    };
  });
  const seibans = [...new Set(parts.flatMap(({ seiban }) => seiban.trim() ? [seiban.trim(), seiban] : []))];
  const [completedOrders, candidates] = await Promise.all([
    productNos.length ? db.$queryRaw<{ productNo: string }[]>`
      SELECT r."rowData"->>'ProductNo' AS "productNo"
      FROM "CsvDashboardRow" r
      LEFT JOIN "ProductionScheduleProgress" AS "p"
        ON "p"."csvDashboardRowId" = r.id AND "p"."csvDashboardId" = r."csvDashboardId"
      LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
        ON "ext"."csvDashboardRowId" = r.id AND "ext"."csvDashboardId" = r."csvDashboardId"
      WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND r."rowData"->>'ProductNo' = ANY(${productNos}::text[])
      GROUP BY r."rowData"->>'ProductNo'
      HAVING bool_and(${buildProductionScheduleEffectiveCompletedSql()})
    ` : [],
    seibans.length ? listPurchasePlannedStartCandidates(seibans, db) : [],
  ]);
  const completedProductNos = new Set(completedOrders.map(row => row.productNo));
  const resolveResults = resolvePurchasePlannedStartCandidates(parts, candidates);
  const completedPurchases = new Set(purchases.filter((_, index) =>
    resolveResults[index]?.completed === true));
  return rows.filter(row => row.slipKind === 'purchase_order'
    ? !completedPurchases.has(row)
    : !completedProductNos.has(normalizeSlipToken(row.manufacturingOrderBarcodeRaw)));
}

/** Both sources share one completion batch inside the caller's transaction. */
export async function countActivePlacementsOnShelf(db: ShelfCompletionDb, shelfCodeRaw: string): Promise<number> {
  const [branches, haizen] = await Promise.all([
    db.orderPlacementBranchState.findMany({ where: { shelfCodeRaw }, select: {
      slipKind: true, manufacturingOrderBarcodeRaw: true, scheduleSnapshot: true,
    } }),
    db.haizenCurrentPlacement.findMany({ where: { shelfCodeRaw }, select: {
      manufacturingOrderBarcodeRaw: true, scheduleSnapshot: true,
    } }),
  ]);
  return (await filterActivePlacements<Placement>([...branches, ...haizen], db)).length;
}
