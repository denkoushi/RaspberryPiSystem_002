import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { GLOBAL_SHARED_LOCATION_KEY } from '../due-management-ranking-scope-policy.service.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';

/** JOIN 後の資源内順位列（LATERAL `ord_pick`） */
export const LEADERBOARD_SHELL_PROCESSING_ORDER_EXPR = Prisma.sql`"ord_pick"."orderNumber"`;

/** JOIN 後の全体順位列（LATERAL `gr_pick`） */
export const LEADERBOARD_SHELL_GLOBAL_RANK_EXPR = Prisma.sql`"gr_pick"."globalRank"`;

export type LeaderboardShellRankJoinContext = {
  orderAssignmentJoin: Prisma.Sql;
  globalRankJoin: Prisma.Sql;
  processingOrderExpr: Prisma.Sql;
  globalRankExpr: Prisma.Sql;
};

/**
 * shell 行 SELECT 用: 相関スカラーの代わりに LATERAL JOIN で資源内順位・全体順位を 1 回評価。
 * ORDER BY / SELECT は {@link LEADERBOARD_SHELL_PROCESSING_ORDER_EXPR} 等を参照する。
 */
export function buildLeaderboardShellRankJoinContext(params: {
  locationKey: string;
  siteScopedGlobalRankLocation: string;
}): LeaderboardShellRankJoinContext {
  const { locationKey, siteScopedGlobalRankLocation } = params;
  const splitOrderAssignmentsEnabled = isProductionScheduleOrderSplitEnabled();

  const orderAssignmentJoin = splitOrderAssignmentsEnabled
    ? Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT MIN(sub."orderNumber") AS "orderNumber"
      FROM (
        (
          SELECT "ord_lat"."orderNumber"
          FROM "ProductionScheduleOrderAssignment" AS "ord_lat"
          WHERE "ord_lat"."csvDashboardRowId" = "CsvDashboardRow"."id"
            AND "ord_lat"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "ord_lat"."location" = ${locationKey}
              OR "ord_lat"."siteKey" = ${locationKey}
            )
          ORDER BY
            CASE WHEN "ord_lat"."location" = ${locationKey} THEN 0 ELSE 1 END ASC,
            "ord_lat"."updatedAt" DESC
          LIMIT 1
        )
        UNION ALL
        SELECT "preferred_split"."orderNumber"
        FROM (
          SELECT DISTINCT ON ("sa"."splitId")
            "sa"."orderNumber"
          FROM "ProductionScheduleOrderSplitAssignment" AS "sa"
          INNER JOIN "ProductionScheduleOrderSplit" AS "s"
            ON "s"."id" = "sa"."splitId"
            AND "s"."parentCsvDashboardRowId" = "CsvDashboardRow"."id"
            AND "s"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          WHERE "sa"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "sa"."location" = ${locationKey}
              OR "sa"."siteKey" = ${locationKey}
            )
          ORDER BY
            "sa"."splitId",
            CASE WHEN "sa"."location" = ${locationKey} THEN 0 ELSE 1 END ASC,
            "sa"."updatedAt" DESC
        ) AS "preferred_split"
      ) AS sub
    ) AS "ord_pick" ON TRUE
  `
    : Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT "ord_lat"."orderNumber"
      FROM "ProductionScheduleOrderAssignment" AS "ord_lat"
      WHERE "ord_lat"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND (
          "ord_lat"."location" = ${locationKey}
          OR "ord_lat"."siteKey" = ${locationKey}
        )
      ORDER BY
        CASE WHEN "ord_lat"."location" = ${locationKey} THEN 0 ELSE 1 END ASC,
        "ord_lat"."updatedAt" DESC
      LIMIT 1
    ) AS "ord_pick" ON TRUE
  `;

  const globalRankJoin = Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT "gr_lat"."globalRank"
      FROM "ProductionScheduleGlobalRowRank" AS "gr_lat"
      WHERE "gr_lat"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "gr_lat"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "gr_lat"."location" IN (
          ${siteScopedGlobalRankLocation},
          ${GLOBAL_SHARED_LOCATION_KEY},
          ${locationKey}
        )
      ORDER BY CASE
        WHEN "gr_lat"."location" = ${siteScopedGlobalRankLocation} THEN 0
        WHEN "gr_lat"."location" = ${GLOBAL_SHARED_LOCATION_KEY} THEN 1
        ELSE 2
      END ASC
      LIMIT 1
    ) AS "gr_pick" ON TRUE
  `;

  return {
    orderAssignmentJoin,
    globalRankJoin,
    processingOrderExpr: LEADERBOARD_SHELL_PROCESSING_ORDER_EXPR,
    globalRankExpr: LEADERBOARD_SHELL_GLOBAL_RANK_EXPR
  };
}
