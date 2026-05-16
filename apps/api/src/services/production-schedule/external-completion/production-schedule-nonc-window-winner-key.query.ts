import { Prisma, type PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { computeProductionScheduleDisappearanceOccurredAtBounds } from '../policies/schedule-csv-disappearance-occurred-at-window.policy.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

/**
 * `FKOJUNST_Status` 同期済みかつ **status が C 以外** の MaxProductNo winner 行で、
 * `occurredAt` が {@link computeProductionScheduleDisappearanceOccurredAtBounds} の窓内にある論理キー一覧。
 *
 * 生産日程CSVの **正本C現在キー集合**（現時点では本体CSV dedupe winner 基準）との差分で消滅完了を決める母集団となる。
 */
export async function queryNonCScheduleDisappearanceCandidateKeys(
  client: PrismaClient,
  params: { referenceAt: Date }
): Promise<string[]> {
  const { windowStart, windowEnd } = computeProductionScheduleDisappearanceOccurredAtBounds(params.referenceAt);

  const rows = await client.$queryRaw<Array<{ k: string }>>(Prisma.sql`
    SELECT DISTINCT (
      BTRIM("cdr"."rowData"->>'FKOJUN')
      || E'\t'
      || UPPER(BTRIM("cdr"."rowData"->>'FSIGENCD'))
      || E'\t'
      || BTRIM("cdr"."rowData"->>'ProductNo')
    ) AS "k"
    FROM "CsvDashboardRow" AS "cdr"
    INNER JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "cdr"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "cdr"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('cdr')}
      AND "fkmail"."statusCode" <> 'C'
      AND "cdr"."occurredAt" >= ${windowStart}
      AND "cdr"."occurredAt" <= ${windowEnd}
    ORDER BY 1 ASC
  `);

  return rows.map((r) => r.k).filter((k) => k.length > 0);
}
