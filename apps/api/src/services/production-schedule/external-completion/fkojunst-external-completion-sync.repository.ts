import { Prisma, type PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildFkojunstSrEligibleScalarSql } from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

export type PrismaExecutor = Pick<PrismaClient, '$executeRaw'>;

/**
 * `FKOJUNST_Status` の「前回同期では存在したが今回の dedupe キー集合から消えたキー」と winner を突き合わせ、外部完了フラグを一括反映する。
 * @param disappearedKeys buildFkojunstMailStatusKey と同一形式のキー（前回スナップショット − 今回キー）
 */
export async function replaceAllWinnerExternalCompletionStates(
  executor: PrismaExecutor,
  disappearedKeys: readonly string[]
): Promise<void> {
  const disappearedSourceSql =
    disappearedKeys.length > 0
      ? Prisma.sql`SELECT * FROM (VALUES ${Prisma.join(
          disappearedKeys.map((k) => Prisma.sql`(${k})`),
          ','
        )}) AS "dk"("k")`
      : Prisma.sql`SELECT CAST(NULL AS text) AS "k" WHERE FALSE`;

  await executor.$executeRaw`
    WITH "disappearedKeys" AS (
      ${disappearedSourceSql}
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
        WHEN EXISTS (SELECT 1 FROM "disappearedKeys" "dk" WHERE "dk"."k" = "w"."rowKey") THEN TRUE
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
