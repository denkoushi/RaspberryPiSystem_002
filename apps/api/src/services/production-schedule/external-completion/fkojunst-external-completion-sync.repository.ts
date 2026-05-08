import { Prisma, type PrismaClient } from '@prisma/client';

import { buildFkojunstMailStatusCompletedScalarSql } from '../completion/fkojunst-mail-status-completion.policy.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildFkojunstScheduleCsvDisappearanceEligibleScalarSql } from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

export type PrismaExecutor = Pick<PrismaClient, '$executeRaw'>;

function buildDisappearedKeysValuesSql(disappearedKeys: readonly string[]): Prisma.Sql {
  return disappearedKeys.length > 0
    ? Prisma.sql`SELECT * FROM (VALUES ${Prisma.join(
        disappearedKeys.map((k) => Prisma.sql`(${k})`),
        ','
      )}) AS "dk"("k")`
    : Prisma.sql`SELECT CAST(NULL AS text) AS "k" WHERE FALSE`;
}

const winnersBaseSql = Prisma.sql`
  SELECT
    "cdr"."id" AS "id",
    (
      BTRIM("cdr"."rowData"->>'FKOJUN')
      || E'\t'
      || UPPER(BTRIM("cdr"."rowData"->>'FSIGENCD'))
      || E'\t'
      || BTRIM("cdr"."rowData"->>'ProductNo')
    ) AS "rowKey",
    ${buildFkojunstScheduleCsvDisappearanceEligibleScalarSql()} AS "scheduleCsvWinnerEligible",
    ${buildFkojunstMailStatusCompletedScalarSql()} AS "mailStatusComplete"
  FROM "CsvDashboardRow" AS "cdr"
  LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
    ON "fkmail"."csvDashboardRowId" = "cdr"."id"
    AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  WHERE "cdr"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND ${buildMaxProductNoWinnerCondition('cdr')}
`;

/**
 * FKOJUNST_Status メール同期後: `fkmail` の **C/X** を外部完了に反映し、生産日程CSV由来フラグは保持する。
 * 旧「メール dedupe キー消失」ロジックは使わない（`externallyCompletedFromFkojunstDisappeared` は常に false に更新）。
 */
export async function replaceAllWinnerExternalCompletionStatesFromMailSync(executor: PrismaExecutor): Promise<void> {
  await executor.$executeRaw`
    WITH "winners" AS (
      ${winnersBaseSql}
    ),
    "computed" AS (
      SELECT
        "w"."id",
        FALSE AS "mailDisappeared",
        "w"."mailStatusComplete" AS "mailStatusComplete"
      FROM "winners" "w"
    )
    INSERT INTO "ProductionScheduleExternalCompletion" (
      "csvDashboardRowId",
      "csvDashboardId",
      "isExternallyCompleted",
      "externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromScheduleCsvDisappeared",
      "createdAt",
      "updatedAt"
    )
    SELECT
      "c"."id",
      ${PRODUCTION_SCHEDULE_DASHBOARD_ID},
      (
        "c"."mailDisappeared"
        OR "c"."mailStatusComplete"
        OR COALESCE("ext"."externallyCompletedFromScheduleCsvDisappeared", FALSE)
      ),
      "c"."mailDisappeared",
      "c"."mailStatusComplete",
      COALESCE("ext"."externallyCompletedFromScheduleCsvDisappeared", FALSE),
      NOW(),
      NOW()
    FROM "computed" "c"
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "c"."id"
    ON CONFLICT ("csvDashboardRowId") DO UPDATE SET
      "externallyCompletedFromFkojunstDisappeared" = EXCLUDED."externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus" = EXCLUDED."externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromScheduleCsvDisappeared" = "ProductionScheduleExternalCompletion"."externallyCompletedFromScheduleCsvDisappeared",
      "isExternallyCompleted" = (
        EXCLUDED."externallyCompletedFromFkojunstDisappeared"
        OR EXCLUDED."externallyCompletedFromFkojunstMailStatus"
        OR "ProductionScheduleExternalCompletion"."externallyCompletedFromScheduleCsvDisappeared"
      ),
      "updatedAt" = NOW()
  `;
}

/**
 * 生産日程CSV 取込後: 取込直前スナップショットとの消滅差分を反映し、工順ST由来2フラグは保持する。
 */
export async function replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync(
  executor: PrismaExecutor,
  disappearedScheduleKeys: readonly string[]
): Promise<void> {
  const disappearedScheduleSql = buildDisappearedKeysValuesSql(disappearedScheduleKeys);

  await executor.$executeRaw`
    WITH "disappearedScheduleKeys" AS (
      ${disappearedScheduleSql}
    ),
    "winners" AS (
      ${winnersBaseSql}
    ),
    "computed" AS (
      SELECT
        "w"."id",
        (
          "w"."scheduleCsvWinnerEligible"
          AND EXISTS (SELECT 1 FROM "disappearedScheduleKeys" "dk" WHERE "dk"."k" = "w"."rowKey")
        ) AS "scheduleDisappeared"
      FROM "winners" "w"
    )
    INSERT INTO "ProductionScheduleExternalCompletion" (
      "csvDashboardRowId",
      "csvDashboardId",
      "isExternallyCompleted",
      "externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromScheduleCsvDisappeared",
      "createdAt",
      "updatedAt"
    )
    SELECT
      "c"."id",
      ${PRODUCTION_SCHEDULE_DASHBOARD_ID},
      (
        COALESCE("ext"."externallyCompletedFromFkojunstDisappeared", FALSE)
        OR COALESCE("ext"."externallyCompletedFromFkojunstMailStatus", FALSE)
        OR "c"."scheduleDisappeared"
      ),
      COALESCE("ext"."externallyCompletedFromFkojunstDisappeared", FALSE),
      COALESCE("ext"."externallyCompletedFromFkojunstMailStatus", FALSE),
      "c"."scheduleDisappeared",
      NOW(),
      NOW()
    FROM "computed" "c"
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "c"."id"
    ON CONFLICT ("csvDashboardRowId") DO UPDATE SET
      "externallyCompletedFromFkojunstDisappeared" = "ProductionScheduleExternalCompletion"."externallyCompletedFromFkojunstDisappeared",
      "externallyCompletedFromFkojunstMailStatus" = "ProductionScheduleExternalCompletion"."externallyCompletedFromFkojunstMailStatus",
      "externallyCompletedFromScheduleCsvDisappeared" = EXCLUDED."externallyCompletedFromScheduleCsvDisappeared",
      "isExternallyCompleted" = (
        "ProductionScheduleExternalCompletion"."externallyCompletedFromFkojunstDisappeared"
        OR "ProductionScheduleExternalCompletion"."externallyCompletedFromFkojunstMailStatus"
        OR EXCLUDED."externallyCompletedFromScheduleCsvDisappeared"
      ),
      "updatedAt" = NOW()
  `;
}

/**
 * @deprecated 呼び出し側は {@link replaceAllWinnerExternalCompletionStatesFromMailSync} を明示利用する。
 * 互換のためメール同期と同じ処理とする。
 */
export async function replaceAllWinnerExternalCompletionStates(
  executor: PrismaExecutor
): Promise<void> {
  await replaceAllWinnerExternalCompletionStatesFromMailSync(executor);
}
