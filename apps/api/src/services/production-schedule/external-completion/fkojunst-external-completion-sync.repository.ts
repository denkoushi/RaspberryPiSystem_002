import { Prisma, type PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildFkojunstSrEligibleScalarSql } from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

export type PrismaExecutor = Pick<PrismaClient, '$executeRaw'>;

/**
 * FKOJUNST_Status CSV のキー集合と突き合わせ、winner 行ごとの外部完了フラグを一括反映する。
 * @param statusKeys buildFkojunstMailStatusKey と同一形式のキー（CSV 側 dedupe 済み集合）
 */
export async function replaceAllWinnerExternalCompletionStates(
  executor: PrismaExecutor,
  statusKeys: readonly string[]
): Promise<void> {
  if (statusKeys.length === 0) {
    throw new Error('[FkojunstExternalCompletionSync] statusKeys must be non-empty');
  }

  const keyRows = statusKeys.map((k) => Prisma.sql`(${k})`);

  await executor.$executeRaw`
    WITH "statusKeys" ("k") AS (
      VALUES ${Prisma.join(keyRows, ',')}
    ),
    "winners" AS (
      SELECT
        "cdr"."id" AS "id",
        (
          BTRIM("cdr"."rowData"->>'FKOJUN')
          || E'\t'
          || UPPER(BTRIM("cdr"."rowData"->>'FSIGENCD'))
          || E'\t'
          || BTRIM("cdr"."rowData"->>'ProductNo')
        ) AS "rowKey",
        ${buildFkojunstSrEligibleScalarSql()} AS "srEligible"
      FROM "CsvDashboardRow" AS "cdr"
      LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
        ON "fkst"."csvDashboardRowId" = "cdr"."id"
        AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
        ON "fkmail"."csvDashboardRowId" = "cdr"."id"
        AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      WHERE "cdr"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${buildMaxProductNoWinnerCondition('cdr')}
    )
    INSERT INTO "ProductionScheduleExternalCompletion" (
      "csvDashboardRowId",
      "csvDashboardId",
      "isExternallyCompleted",
      "createdAt",
      "updatedAt"
    )
    SELECT
      "w"."id",
      ${PRODUCTION_SCHEDULE_DASHBOARD_ID},
      CASE
        WHEN NOT "w"."srEligible" THEN FALSE
        WHEN NOT EXISTS (SELECT 1 FROM "statusKeys" "sk" WHERE "sk"."k" = "w"."rowKey") THEN TRUE
        ELSE FALSE
      END,
      NOW(),
      NOW()
    FROM "winners" "w"
    ON CONFLICT ("csvDashboardRowId") DO UPDATE SET
      "isExternallyCompleted" = EXCLUDED."isExternallyCompleted",
      "updatedAt" = NOW()
  `;
}
