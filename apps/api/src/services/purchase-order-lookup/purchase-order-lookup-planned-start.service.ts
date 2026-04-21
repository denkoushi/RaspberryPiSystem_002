import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { fhincdMatchKeyFromRowDataExpr } from './purchase-fhincd-match-sql.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';

/** `(FSEIBAN, 照合キーFHINCD)` をキーにした着手日マップ用の結合キー */
export function purchaseOrderLookupSeibanMatchKey(seiban: string, matchKeyFhinCd: string): string {
  return `${seiban.trim()}\t${matchKeyFhinCd.trim()}`;
}

/** 段階移行フォールバック用の `(FSEIBAN, 正規化FHINCD)` 結合キー */
export function purchaseOrderLookupSeibanNormKey(seiban: string, normalizedFhinCd: string): string {
  return `${seiban.trim()}\t${normalizedFhinCd.trim()}`;
}

function normalizedFhincdFromRowDataExpr(rowAlias: string): Prisma.Sql {
  return Prisma.raw(
    `regexp_replace(trim(COALESCE("${rowAlias}"."rowData"->>'FHINCD', '')), '\\([^)]*\\)', '', 'g')`
  );
}

/**
 * 生産日程の部品納期個数補助（`ProductionScheduleOrderSupplement.plannedStartDate`）から、
 * (FSEIBAN, 照合キーFHINCD) ごとに最古の着手日を返す（納期管理の部品集約と同様に earliest）。
 */
export async function findEarliestPlannedStartDatesBySeibanAndMatchKey(
  pairs: Array<{ seiban: string; purchasePartCodeMatchKey: string }>
): Promise<Record<string, Date | null>> {
  const uniquePairs = new Map<string, { seiban: string; matchKey: string }>();
  for (const p of pairs) {
    const s = p.seiban.trim();
    const n = p.purchasePartCodeMatchKey.trim();
    if (s.length === 0 || n.length === 0) continue;
    uniquePairs.set(purchaseOrderLookupSeibanMatchKey(s, n), { seiban: s, matchKey: n });
  }

  const result: Record<string, Date | null> = {};
  for (const key of uniquePairs.keys()) {
    result[key] = null;
  }
  if (uniquePairs.size === 0) {
    return result;
  }

  const matchExpr = fhincdMatchKeyFromRowDataExpr('r');
  const pairsArray = [...uniquePairs.values()];
  const orClause =
    pairsArray.length === 1
      ? Prisma.sql`(
          trim(COALESCE(r."rowData"->>'FSEIBAN', '')) = ${pairsArray[0].seiban}
          AND ${matchExpr} = ${pairsArray[0].matchKey}
        )`
      : Prisma.sql`(${Prisma.join(
          pairsArray.map(
            ({ seiban, matchKey }) =>
              Prisma.sql`(
                trim(COALESCE(r."rowData"->>'FSEIBAN', '')) = ${seiban}
                AND ${matchExpr} = ${matchKey}
              )`
          ),
          ' OR '
        )})`;

  const rows = await prisma.$queryRaw<Array<{ seiban: string; match_fhincd: string; min_start: Date | null }>>`
    SELECT
      trim(COALESCE(r."rowData"->>'FSEIBAN', '')) AS seiban,
      ${matchExpr} AS match_fhincd,
      MIN(s."plannedStartDate") AS min_start
    FROM "ProductionScheduleOrderSupplement" s
    INNER JOIN "CsvDashboardRow" r ON r.id = s."csvDashboardRowId"
    WHERE s."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${orClause}
      AND ${buildMaxProductNoWinnerCondition('r')}
    GROUP BY 1, 2
  `;

  for (const row of rows) {
    const k = purchaseOrderLookupSeibanMatchKey(row.seiban, row.match_fhincd);
    if (k in result && row.min_start != null) {
      result[k] = row.min_start;
    }
  }
  return result;
}

/**
 * 段階移行フォールバック用: (FSEIBAN, 正規化FHINCD) ごとに最古の着手日を返す。
 */
export async function findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd(
  pairs: Array<{ seiban: string; purchasePartCodeNormalized: string }>
): Promise<Record<string, Date | null>> {
  const uniquePairs = new Map<string, { seiban: string; normalized: string }>();
  for (const p of pairs) {
    const s = p.seiban.trim();
    const n = p.purchasePartCodeNormalized.trim();
    if (s.length === 0 || n.length === 0) continue;
    uniquePairs.set(purchaseOrderLookupSeibanNormKey(s, n), { seiban: s, normalized: n });
  }

  const result: Record<string, Date | null> = {};
  for (const key of uniquePairs.keys()) {
    result[key] = null;
  }
  if (uniquePairs.size === 0) {
    return result;
  }

  const normalizedExpr = normalizedFhincdFromRowDataExpr('r');
  const pairsArray = [...uniquePairs.values()];
  const orClause =
    pairsArray.length === 1
      ? Prisma.sql`(
          trim(COALESCE(r."rowData"->>'FSEIBAN', '')) = ${pairsArray[0].seiban}
          AND ${normalizedExpr} = ${pairsArray[0].normalized}
        )`
      : Prisma.sql`(${Prisma.join(
          pairsArray.map(
            ({ seiban, normalized }) =>
              Prisma.sql`(
                trim(COALESCE(r."rowData"->>'FSEIBAN', '')) = ${seiban}
                AND ${normalizedExpr} = ${normalized}
              )`
          ),
          ' OR '
        )})`;

  const rows = await prisma.$queryRaw<Array<{ seiban: string; normalized_fhincd: string; min_start: Date | null }>>`
    SELECT
      trim(COALESCE(r."rowData"->>'FSEIBAN', '')) AS seiban,
      ${normalizedExpr} AS normalized_fhincd,
      MIN(s."plannedStartDate") AS min_start
    FROM "ProductionScheduleOrderSupplement" s
    INNER JOIN "CsvDashboardRow" r ON r.id = s."csvDashboardRowId"
    WHERE s."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${orClause}
      AND ${buildMaxProductNoWinnerCondition('r')}
    GROUP BY 1, 2
  `;

  for (const row of rows) {
    const k = purchaseOrderLookupSeibanNormKey(row.seiban, row.normalized_fhincd);
    if (k in result && row.min_start != null) {
      result[k] = row.min_start;
    }
  }
  return result;
}
