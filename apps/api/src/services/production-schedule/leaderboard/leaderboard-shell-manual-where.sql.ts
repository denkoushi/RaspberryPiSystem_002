import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

/**
 * 手動順番を持つ行だけを返す shell 用 WHERE。
 *
 * EXISTS だけだと、資源の全候補行に表示用 JOIN を済ませてから最後に半結合で絞る計画になり、
 * 手動行が 0 件でも資源 1 つあたり約 0.5 秒かかっていた（Pi5 実測）。
 * 割当表から先に親行 id 配列を作り（InitPlan 1 回）、`id = ANY(...)` で主キー索引から引かせる。
 * id 配列は EXISTS と同じ集合なので結果は変わらない。EXISTS は意味の正本として残す。
 */
export function buildLeaderboardShellManualPriorityWhereSql(params: {
  commonWhere: Prisma.Sql;
  locationKey: string;
}): Prisma.Sql {
  const { commonWhere, locationKey } = params;

  return Prisma.sql`${commonWhere}
      AND "CsvDashboardRow"."id" = ANY(ARRAY(
          SELECT "ord_c"."csvDashboardRowId"
          FROM "ProductionScheduleOrderAssignment" AS "ord_c"
          WHERE "ord_c"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "ord_c"."location" = ${locationKey}
              OR "ord_c"."siteKey" = ${locationKey}
            )
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
        )
      )`;
}
