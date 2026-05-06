import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  buildFkojunstProductionScheduleListRowDataFkojunstSql,
  buildFkojunstProductionScheduleListVisibilityWhereSql
} from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule-effective-completion.sql.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import { buildLeaderboardGlobalRankScalarSql } from './leaderboard-global-rank-scalar.sql.js';
import type { LeaderboardScheduleRowSql } from './leaderboard-row-selection.service.js';

const MAX_ROWS = 900;

/**
 * leaderboard 一覧と SELECT 構造・可視 WHERE をそろえ、入力 row id 順で行を hydrate する（装飾 API 向け）。
 */
export async function fetchLeaderboardScheduleHydratedRowsOrderedByIds(params: {
  orderedRowIds: readonly string[];
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  /** 呼び出し元が既に確定している場合、winner materialization クエリを省略 */
  leaderboardMaterializedBaseWhere?: Prisma.Sql;
}): Promise<LeaderboardScheduleRowSql[]> {
  const { locationKey, siteScopedGlobalRankLocation } = params;
  const seen = new Set<string>();
  const uniqueOrdered: string[] = [];
  for (const raw of params.orderedRowIds) {
    const id = raw.trim();
    if (!id.length || seen.has(id)) continue;
    seen.add(id);
    uniqueOrdered.push(id);
    if (uniqueOrdered.length >= MAX_ROWS) break;
  }

  if (uniqueOrdered.length === 0) {
    return [];
  }

  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(
    prisma,
    params.leaderboardMaterializedBaseWhere
  );

  const processingOrderScalar = Prisma.sql`(
    SELECT "orderNumber"
    FROM "ProductionScheduleOrderAssignment"
    WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
      AND (
        "location" = ${locationKey}
        OR "siteKey" = ${locationKey}
      )
    ORDER BY
      CASE WHEN "location" = ${locationKey} THEN 0 ELSE 1 END ASC,
      "updatedAt" DESC
    LIMIT 1
  )`;

  const orderedIdParts = uniqueOrdered.map((id) => Prisma.sql`${id}`);
  const orderedIdArraySql = Prisma.sql`ARRAY[${Prisma.join(orderedIdParts)}]::text[]`;

  return prisma.$queryRaw<LeaderboardScheduleRowSql[]>`
    SELECT
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
      ${processingOrderScalar} AS "processingOrder",
      ${buildLeaderboardGlobalRankScalarSql({ siteScopedGlobalRankLocation, locationKey })} AS "globalRank",
      NULLIF(TRIM("n"."note"), '') AS "note",
      COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
      "n"."dueDate" AS "dueDate",
      "supplement"."plannedQuantity" AS "plannedQuantity",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      "supplement"."plannedEndDate" AS "plannedEndDate"
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
    WHERE ${leaderboardMaterializedBaseWhere}
      ${visibilitySql}
      AND "CsvDashboardRow"."id"::text IN (${Prisma.join(orderedIdParts)})
    ORDER BY array_position(${orderedIdArraySql}, "CsvDashboardRow"."id"::text)
  `;
}
