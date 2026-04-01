import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from './constants.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

type SupplementNormalizedRow = {
  sourceRowId: string;
  productNo: string;
  resourceCd: string;
  processOrder: string;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
};

type WinnerKeyRow = {
  id: string;
  productNo: string | null;
  resourceCd: string | null;
  processOrder: string | null;
};

type SyncResult = {
  scanned: number;
  normalized: number;
  matched: number;
  unmatched: number;
  upserted: number;
  pruned: number;
};

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

const buildKey = (params: { productNo: string; resourceCd: string; processOrder: string }): string =>
  `${params.productNo}\t${params.resourceCd}\t${params.processOrder}`;

const parseQuantity = (value: unknown): number | null => {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return null;
  if (!/^-?\d+$/.test(normalized)) return null;
  return Number.parseInt(normalized, 10);
};

const parsePlannedDate = (value: unknown): Date | null => {
  const normalized = normalizeToken(value);
  if (normalized.length === 0) return null;

  const ymdMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const mdYMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?$/);
  if (!mdYMatch) return null;
  const [, m, d, y] = mdYMatch;
  const month = m.padStart(2, '0');
  const day = d.padStart(2, '0');
  const date = new Date(`${y}-${month}-${day}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toNormalizedRow = (sourceRowId: string, rowData: Record<string, unknown>): SupplementNormalizedRow | null => {
  const productNo = normalizeToken(rowData.ProductNo);
  const processOrder = normalizeToken(rowData.FKOJUN);
  const resourceCd = normalizeProductionScheduleResourceCd(normalizeToken(rowData.FSIGENCD));
  if (productNo.length === 0 || processOrder.length === 0 || resourceCd.length === 0) {
    return null;
  }
  return {
    sourceRowId,
    productNo,
    resourceCd,
    processOrder,
    plannedQuantity: parseQuantity(rowData.plannedQuantity),
    plannedStartDate: parsePlannedDate(rowData.plannedStartDate),
    plannedEndDate: parsePlannedDate(rowData.plannedEndDate),
  };
};

export class ProductionScheduleOrderSupplementSyncService {
  async syncFromSupplementDashboard(): Promise<SyncResult> {
    const sourceRows = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID },
      select: { id: true, rowData: true },
    });

    const normalizedRows = sourceRows
      .map((row) => toNormalizedRow(row.id, row.rowData as Record<string, unknown>))
      .filter((row): row is SupplementNormalizedRow => row !== null);

    if (normalizedRows.length === 0) {
      return prisma.$transaction(async (tx) => {
        const pruneResult = await tx.productionScheduleOrderSupplement.deleteMany({
          where: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
          },
        });
        return {
          scanned: sourceRows.length,
          normalized: 0,
          matched: 0,
          unmatched: 0,
          upserted: 0,
          pruned: pruneResult.count,
        };
      });
    }

    const dedupedByKey = new Map<string, SupplementNormalizedRow>();
    for (const row of normalizedRows) {
      dedupedByKey.set(
        buildKey({ productNo: row.productNo, resourceCd: row.resourceCd, processOrder: row.processOrder }),
        row
      );
    }
    const dedupedRows = [...dedupedByKey.values()];

    const productNos = [...new Set(dedupedRows.map((row) => row.productNo))];
    const resourceCds = [...new Set(dedupedRows.map((row) => row.resourceCd))];
    const processOrders = [...new Set(dedupedRows.map((row) => row.processOrder))];

    return prisma.$transaction(async (tx) => {
      const winnerRows = await tx.$queryRaw<WinnerKeyRow[]>`
        SELECT
          "CsvDashboardRow"."id" AS "id",
          "CsvDashboardRow"."rowData"->>'ProductNo' AS "productNo",
          UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) AS "resourceCd",
          BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') AS "processOrder"
        FROM "CsvDashboardRow"
        WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
          AND ("CsvDashboardRow"."rowData"->>'ProductNo') IN (${Prisma.join(productNos.map((value) => Prisma.sql`${value}`), ',')})
          AND UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) IN (${Prisma.join(resourceCds.map((value) => Prisma.sql`${value}`), ',')})
          AND BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') IN (${Prisma.join(processOrders.map((value) => Prisma.sql`${value}`), ',')})
      `;

      const winnerIdByKey = new Map<string, string>();
      for (const row of winnerRows) {
        const productNo = normalizeToken(row.productNo);
        const resourceCd = normalizeProductionScheduleResourceCd(normalizeToken(row.resourceCd));
        const processOrder = normalizeToken(row.processOrder);
        if (productNo.length === 0 || resourceCd.length === 0 || processOrder.length === 0) continue;
        winnerIdByKey.set(buildKey({ productNo, resourceCd, processOrder }), row.id);
      }

      let upserted = 0;
      let matched = 0;
      let unmatched = 0;
      const matchedWinnerRowIds = new Set<string>();
      for (const row of dedupedRows) {
        const key = buildKey({ productNo: row.productNo, resourceCd: row.resourceCd, processOrder: row.processOrder });
        const winnerRowId = winnerIdByKey.get(key);
        if (!winnerRowId) {
          unmatched += 1;
          continue;
        }
        matched += 1;
        matchedWinnerRowIds.add(winnerRowId);
        await tx.productionScheduleOrderSupplement.upsert({
          where: { csvDashboardRowId: winnerRowId },
          update: {
            sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
            productNo: row.productNo,
            resourceCd: row.resourceCd,
            processOrder: row.processOrder,
            plannedQuantity: row.plannedQuantity,
            plannedStartDate: row.plannedStartDate,
            plannedEndDate: row.plannedEndDate,
          },
          create: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            csvDashboardRowId: winnerRowId,
            sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
            productNo: row.productNo,
            resourceCd: row.resourceCd,
            processOrder: row.processOrder,
            plannedQuantity: row.plannedQuantity,
            plannedStartDate: row.plannedStartDate,
            plannedEndDate: row.plannedEndDate,
          },
        });
        upserted += 1;
      }

      const pruneResult = await tx.productionScheduleOrderSupplement.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
          ...(matchedWinnerRowIds.size > 0
            ? {
                csvDashboardRowId: {
                  notIn: [...matchedWinnerRowIds],
                },
              }
            : {}),
        },
      });

      const result: SyncResult = {
        scanned: sourceRows.length,
        normalized: dedupedRows.length,
        matched,
        unmatched,
        upserted,
        pruned: pruneResult.count,
      };
      logger.info(result, '[ProductionScheduleOrderSupplementSyncService] Order supplement sync completed');
      return result;
    });
  }
}
