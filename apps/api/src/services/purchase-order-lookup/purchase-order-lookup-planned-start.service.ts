import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';

/** `(FSEIBAN, 正規化FHINCD)` をキーにした着手日マップ用の結合キー */
export function purchaseOrderLookupSeibanNormKey(seiban: string, normalizedFhinCd: string): string {
  return `${seiban.trim()}\t${normalizedFhinCd.trim()}`;
}

/**
 * 生産日程の部品納期個数補助（`ProductionScheduleOrderSupplement.plannedStartDate`）から、
 * (FSEIBAN, 正規化FHINCD) ごとに最古の着手日を返す（納期管理の部品集約と同様に earliest）。
 */
export async function findEarliestPlannedStartDatesBySeibanAndNormalizedFhinCd(
  pairs: Array<{ seiban: string; purchasePartCodeNormalized: string }>
): Promise<Record<string, Date | null>> {
  const uniquePairs = new Map<string, { seiban: string; norm: string }>();
  for (const p of pairs) {
    const s = p.seiban.trim();
    const n = p.purchasePartCodeNormalized.trim();
    if (s.length === 0 || n.length === 0) continue;
    uniquePairs.set(purchaseOrderLookupSeibanNormKey(s, n), { seiban: s, norm: n });
  }

  const result: Record<string, Date | null> = {};
  for (const key of uniquePairs.keys()) {
    result[key] = null;
  }
  if (uniquePairs.size === 0) {
    return result;
  }

  const pairsArray = [...uniquePairs.values()];
  const orClause =
    pairsArray.length === 1
      ? Prisma.sql`(
          trim(COALESCE(r."rowData"->>'FSEIBAN', '')) = ${pairsArray[0].seiban}
          AND regexp_replace(
            trim(COALESCE(r."rowData"->>'FHINCD', '')),
            '\\([^)]*\\)',
            '',
            'g'
          ) = ${pairsArray[0].norm}
        )`
      : Prisma.sql`(${Prisma.join(
          pairsArray.map(
            ({ seiban, norm }) =>
              Prisma.sql`(
                trim(COALESCE(r."rowData"->>'FSEIBAN', '')) = ${seiban}
                AND regexp_replace(
                  trim(COALESCE(r."rowData"->>'FHINCD', '')),
                  '\\([^)]*\\)',
                  '',
                  'g'
                ) = ${norm}
              )`
          ),
          ' OR '
        )})`;

  const rows = await prisma.$queryRaw<Array<{ seiban: string; norm_fhincd: string; min_start: Date | null }>>`
    SELECT
      trim(COALESCE(r."rowData"->>'FSEIBAN', '')) AS seiban,
      regexp_replace(
        trim(COALESCE(r."rowData"->>'FHINCD', '')),
        '\\([^)]*\\)',
        '',
        'g'
      ) AS norm_fhincd,
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
    const k = purchaseOrderLookupSeibanNormKey(row.seiban, row.norm_fhincd);
    if (k in result && row.min_start != null) {
      result[k] = row.min_start;
    }
  }
  return result;
}
