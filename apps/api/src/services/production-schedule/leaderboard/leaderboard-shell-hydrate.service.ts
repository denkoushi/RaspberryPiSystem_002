import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { COMPLETED_PROGRESS_VALUE, PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  buildFkojunstProductionScheduleListRowDataFkojunstSql,
  buildFkojunstProductionScheduleListVisibilityWhereSql
} from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule-effective-completion.sql.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import {
  buildLeaderboardShellRankJoinContext,
  LEADERBOARD_SHELL_GLOBAL_RANK_EXPR,
  LEADERBOARD_SHELL_PROCESSING_ORDER_EXPR
} from './leaderboard-shell-rank-join.sql.js';
import {
  chunkLeaderboardRowIdsForHydrate,
  normalizeLeaderboardDisplayRowIdScope
} from './leaderboard-display-row-scope.js';
import type { LeaderboardScheduleRowSql } from './leaderboard-schedule-row.types.js';

/**
 * 単一チャンク（長さ <= LEADERBOARD_HYDRATE_SQL_BATCH_MAX）向け hydrate。
 * @internal 直接利用より `fetchLeaderboardScheduleHydratedRowsOrderedByIds` を使うこと。
 */
async function fetchLeaderboardScheduleHydratedRowsSingleBatch(params: {
  orderedRowIdsChunk: readonly string[];
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  /** 指定時は `leaderboardMaterializedBaseWhere` + 可視条件の代わりに shell 一覧と同一の行スコープを使う */
  leaderboardShellListWhere?: Prisma.Sql;
}): Promise<LeaderboardScheduleRowSql[]> {
  const {
    orderedRowIdsChunk,
    locationKey,
    siteScopedGlobalRankLocation,
    leaderboardMaterializedBaseWhere,
    leaderboardShellListWhere
  } = params;

  if (orderedRowIdsChunk.length === 0) {
    return [];
  }

  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const rowScopeWhere =
    leaderboardShellListWhere ?? Prisma.sql`${leaderboardMaterializedBaseWhere} ${visibilitySql}`;

  const rankJoins = buildLeaderboardShellRankJoinContext({ locationKey, siteScopedGlobalRankLocation });

  const orderedIdParts = orderedRowIdsChunk.map((id) => Prisma.sql`${id}`);
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
      ${LEADERBOARD_SHELL_PROCESSING_ORDER_EXPR} AS "processingOrder",
      ${LEADERBOARD_SHELL_GLOBAL_RANK_EXPR} AS "globalRank",
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
    ${rankJoins.orderAssignmentJoin}
    ${rankJoins.globalRankJoin}
    WHERE ${rowScopeWhere}
      AND "CsvDashboardRow"."id"::text IN (${Prisma.join(orderedIdParts)})
    ORDER BY array_position(${orderedIdArraySql}, "CsvDashboardRow"."id"::text)
  `;
}

/**
 * leaderboard 一覧と SELECT 構造・可視 WHERE をそろえ、入力 row id 順で行を hydrate する（装飾 API 向け）。
 * ID が LEADERBOARD_HYDRATE_SQL_BATCH_MAX を超える場合は複数クエリに分割し、**表示順を維持して結合**する。
 */
export async function fetchLeaderboardScheduleHydratedRowsOrderedByIds(params: {
  orderedRowIds: readonly string[];
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  /** 呼び出し元が既に確定している場合、winner materialization クエリを省略 */
  leaderboardMaterializedBaseWhere?: Prisma.Sql;
  /** shell 一覧と同一の行スコープ（query / 残骸除外を含む） */
  leaderboardShellListWhere?: Prisma.Sql;
}): Promise<LeaderboardScheduleRowSql[]> {
  const { locationKey, siteScopedGlobalRankLocation, leaderboardShellListWhere } = params;

  const uniqueOrdered = normalizeLeaderboardDisplayRowIdScope(params.orderedRowIds);
  if (uniqueOrdered.length === 0) {
    return [];
  }

  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(
    prisma,
    params.leaderboardMaterializedBaseWhere
  );

  const chunks = chunkLeaderboardRowIdsForHydrate(uniqueOrdered);
  const byId = new Map<string, LeaderboardScheduleRowSql>();

  for (const chunk of chunks) {
    const batch = await fetchLeaderboardScheduleHydratedRowsSingleBatch({
      orderedRowIdsChunk: chunk,
      locationKey,
      siteScopedGlobalRankLocation,
      leaderboardMaterializedBaseWhere,
      leaderboardShellListWhere
    });
    for (const row of batch) {
      if (!byId.has(row.id)) {
        byId.set(row.id, row);
      }
    }
  }

  return uniqueOrdered.map((id) => byId.get(id)).filter((r): r is LeaderboardScheduleRowSql => r !== undefined);
}
