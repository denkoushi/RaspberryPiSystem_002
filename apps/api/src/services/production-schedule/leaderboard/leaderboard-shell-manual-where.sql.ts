import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

/**
 * 手動順番（＋分割時は分割割当の親行）を持つ行だけを返す shell 用 WHERE。
 *
 * EXISTS だけだと、資源の全候補行に表示用 JOIN を済ませてから最後に半結合で絞る計画になり、
 * 手動行が 0 件でも資源 1 つあたり約 0.5 秒かかっていた（Pi5 実測）。
 * 割当表から先に親行 id 配列を作り（InitPlan 1 回）、`id = ANY(...)` で主キー索引から引かせる。
 * id 配列は EXISTS と同じ集合なので結果は変わらない。EXISTS は意味の正本として残す。
 */
export function buildLeaderboardShellManualPriorityWhereSql(params: {
  commonWhere: Prisma.Sql;
  locationKey: string;
  splitEnabled: boolean;
}): Prisma.Sql {
  const { commonWhere, locationKey, splitEnabled } = params;

  const splitCandidateIdsSql = splitEnabled
    ? Prisma.sql`
          UNION ALL
          SELECT "s_c"."parentCsvDashboardRowId"
          FROM "ProductionScheduleOrderSplitAssignment" AS "sa_c"
          INNER JOIN "ProductionScheduleOrderSplit" AS "s_c"
            ON "s_c"."id" = "sa_c"."splitId"
            AND "s_c"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          WHERE "sa_c"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "sa_c"."location" = ${locationKey}
              OR "sa_c"."siteKey" = ${locationKey}
            )`
    : Prisma.empty;

  const splitExistsSql = splitEnabled
    ? Prisma.sql`
        OR EXISTS (
          SELECT 1
          FROM "ProductionScheduleOrderSplitAssignment" AS "sa_m"
          INNER JOIN "ProductionScheduleOrderSplit" AS "s_m"
            ON "s_m"."id" = "sa_m"."splitId"
            AND "s_m"."parentCsvDashboardRowId" = "CsvDashboardRow"."id"
            AND "s_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          WHERE "sa_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "sa_m"."location" = ${locationKey}
              OR "sa_m"."siteKey" = ${locationKey}
            )
        )`
    : Prisma.empty;

  return Prisma.sql`${commonWhere}
      AND "CsvDashboardRow"."id" = ANY(ARRAY(
          SELECT "ord_c"."csvDashboardRowId"
          FROM "ProductionScheduleOrderAssignment" AS "ord_c"
          WHERE "ord_c"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "ord_c"."location" = ${locationKey}
              OR "ord_c"."siteKey" = ${locationKey}
            )${splitCandidateIdsSql}
        ))
      AND (
        EXISTS (
          SELECT 1
          FROM "ProductionScheduleOrderAssignment" AS "ord_m"
          WHERE "ord_m"."csvDashboardRowId" = "CsvDashboardRow"."id"
            AND "ord_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "ord_m"."location" = ${locationKey}
              OR "ord_m"."siteKey" = ${locationKey}
            )
        )${splitExistsSql}
      )`;
}
