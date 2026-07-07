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
   * 生産実績 Raw から製番ごとのロット数合計を返す。
   * 同一製番・ロットNo・ロット数の重複行（工程/資源ごとの実績行）を除外してから lotQty を合算する。
   */
  async listByProductNos(productNos: string[]): Promise<AssemblySeibanLotQuantity[]> {
    const normalizedProductNos = clampProductNos(productNos);
    if (normalizedProductNos.length === 0) return [];

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
          AND UPPER(TRIM("fseiban")) IN (${Prisma.join(normalizedProductNos)})
      ) AS distinct_lots
      GROUP BY UPPER(TRIM("fseiban"))
    `;

    return rows.map((row) => ({
      productNo: row.productNo,
      lotQty: Number(row.lotQty)
    }));
  }
}
