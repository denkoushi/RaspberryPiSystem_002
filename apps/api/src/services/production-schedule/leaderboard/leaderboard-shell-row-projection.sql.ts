import { Prisma } from '@prisma/client';

import {
  COMPLETED_PROGRESS_VALUE,
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from '../constants.js';
import {
  buildFkojunstProductionScheduleListRowDataFkojunstSql,
} from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule-effective-completion.sql.js';
import type { LeaderboardShellRankJoinContext } from './leaderboard-shell-rank-join.sql.js';

/** 納期ソート用（note / supplement JOIN 後に評価） */
export const LEADERBOARD_SHELL_DUE_SORT_EXPR = Prisma.sql`COALESCE("n"."dueDate", "supplement"."plannedEndDate")`;

/**
 * CsvDashboardRow + 可視性・装飾 JOIN + rank LATERAL（manual / expansion / filler 共通）。
 */
export function buildLeaderboardShellRowFromJoins(rankJoins: LeaderboardShellRankJoinContext): Prisma.Sql {
  return Prisma.sql`
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
      ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    ${rankJoins.orderAssignmentJoin}
    ${rankJoins.globalRankJoin}
  `;
}

/** shell 行 SELECT 列（enrich 前・3 クエリ共通）。 */
export function buildLeaderboardShellRowSelectList(rankJoins: LeaderboardShellRankJoinContext): Prisma.Sql {
  return Prisma.sql`
    "CsvDashboardRow"."id",
    NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "seibanJoinKey",
    "CsvDashboardRow"."occurredAt",
    jsonb_build_object(
      'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
      'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
      'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
      'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
      'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
      'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
      'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN',
      'FKOJUNST', ( ${buildFkojunstProductionScheduleListRowDataFkojunstSql()} ),
      'progress', (CASE WHEN ${buildProductionScheduleEffectiveCompletedSql()} THEN ${COMPLETED_PROGRESS_VALUE} ELSE '' END)
    ) AS "rowData",
    ${rankJoins.processingOrderExpr} AS "processingOrder",
    ${rankJoins.globalRankExpr} AS "globalRank",
    NULLIF(TRIM("n"."note"), '') AS "note",
    COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
    "n"."dueDate" AS "dueDate",
    "supplement"."plannedQuantity" AS "plannedQuantity",
    "supplement"."plannedStartDate" AS "plannedStartDate",
    "supplement"."plannedEndDate" AS "plannedEndDate"
  `;
}

/** manual 行 ORDER BY（資源内順位優先）。 */
export function buildLeaderboardShellManualOrderBy(rankJoins: LeaderboardShellRankJoinContext): Prisma.Sql {
  return Prisma.sql`
    ${rankJoins.processingOrderExpr} ASC NULLS LAST,
    ${LEADERBOARD_SHELL_DUE_SORT_EXPR} ASC NULLS LAST,
    ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
    ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
    (CASE
      WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
      ELSE NULL
    END) ASC NULLS LAST,
    ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
  `;
}

/** filler / expansion 行 ORDER BY（納期優先）。 */
export function buildLeaderboardShellFillerOrderBy(): Prisma.Sql {
  return Prisma.sql`
    ${LEADERBOARD_SHELL_DUE_SORT_EXPR} ASC NULLS LAST,
    ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
    ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
    (CASE
      WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
      ELSE NULL
    END) ASC NULLS LAST,
    ("CsvDashboardRow"."rowData"->>'FHINCD') ASC,
    "CsvDashboardRow"."id"::text ASC
  `;
}
