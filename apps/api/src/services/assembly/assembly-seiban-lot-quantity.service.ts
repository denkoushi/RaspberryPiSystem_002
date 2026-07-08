import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { normalizeAssemblyUpperIdentifier } from './assembly-identifiers.js';

export type AssemblySeibanLotQuantity = {
  productNo: string;
  lotQty: number;
};

type LotQuantityRow = {
  productNo: string;
  lotQty: number | string;
};

function clampProductNos(productNos: string[]): string[] {
  const unique = new Set<string>();
  for (const productNo of productNos) {
    const normalized = normalizeAssemblyUpperIdentifier(productNo);
    if (normalized.length > 0) unique.add(normalized);
    if (unique.size >= 100) break;
  }
  return [...unique];
}

export class AssemblySeibanLotQuantityService {
  /**
   * 製番ごとのロット数を返す。
   * 一次ルートは順位ボードと同じ ProductionScheduleOrderSupplement.plannedQuantity の最頻値（同数なら最小）。
   * 指示数が得られない製番のみ、生産実績 Raw の lotQty 合算で補完する。
   */
  async listByProductNos(productNos: string[]): Promise<AssemblySeibanLotQuantity[]> {
    const normalizedProductNos = clampProductNos(productNos);
    if (normalizedProductNos.length === 0) return [];

    const fromSupplement = await this.listLotQuantitiesFromOrderSupplement(normalizedProductNos);
    const foundProductNos = new Set(fromSupplement.map((row) => row.productNo));
    const missingProductNos = normalizedProductNos.filter((productNo) => !foundProductNos.has(productNo));
    if (missingProductNos.length === 0) return fromSupplement;

    const fromActualHours = await this.listLotQuantitiesFromActualHours(missingProductNos);
    return [...fromSupplement, ...fromActualHours];
  }

  private async listLotQuantitiesFromOrderSupplement(productNos: string[]): Promise<AssemblySeibanLotQuantity[]> {
    const rows = await prisma.$queryRaw<LotQuantityRow[]>`
      WITH distinct_planned AS (
        SELECT DISTINCT
          UPPER(BTRIM(row."rowData"->>'FSEIBAN')) AS "productNo",
          supplement."plannedQuantity" AS "plannedQuantity"
        FROM "CsvDashboardRow" AS row
        INNER JOIN "ProductionScheduleOrderSupplement" AS supplement
          ON supplement."csvDashboardRowId" = row.id
          AND supplement."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        WHERE row."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND UPPER(BTRIM(row."rowData"->>'FSEIBAN')) IN (${Prisma.join(productNos)})
          AND supplement."plannedQuantity" IS NOT NULL
          AND supplement."plannedQuantity" > 0
      ),
      quantity_counts AS (
        SELECT
          "productNo",
          "plannedQuantity",
          COUNT(*)::int AS cnt
        FROM distinct_planned
        GROUP BY "productNo", "plannedQuantity"
      ),
      ranked AS (
        SELECT
          "productNo",
          "plannedQuantity" AS "lotQty",
          ROW_NUMBER() OVER (
            PARTITION BY "productNo"
            ORDER BY cnt DESC, "plannedQuantity" ASC
          ) AS rn
        FROM quantity_counts
      )
      SELECT "productNo", "lotQty"
      FROM ranked
      WHERE rn = 1
    `;

    // 1製品に同一部品を2個使う仕様では部品行の指示数がロット数の倍になるため、最頻値（同数なら最小）を製品ロット数として採用する。
    return rows.map((row) => ({
      productNo: row.productNo,
      lotQty: Number(row.lotQty)
    }));
  }

  private async listLotQuantitiesFromActualHours(productNos: string[]): Promise<AssemblySeibanLotQuantity[]> {
    const rows = await prisma.$queryRaw<LotQuantityRow[]>`
      SELECT
        UPPER(TRIM("fseiban")) AS "productNo",
        SUM("lotQty")::float AS "lotQty"
      FROM (
        SELECT DISTINCT
          "fseiban",
          "lotNo",
          "lotQty"
        FROM "ProductionScheduleActualHoursRaw"
        WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "fseiban" IS NOT NULL
          AND TRIM("fseiban") <> ''
          AND "isExcluded" = false
          AND UPPER(TRIM("fseiban")) IN (${Prisma.join(productNos)})
      ) AS distinct_lots
      GROUP BY UPPER(TRIM("fseiban"))
    `;

    return rows.map((row) => ({
      productNo: row.productNo,
      lotQty: Number(row.lotQty)
    }));
  }
}
