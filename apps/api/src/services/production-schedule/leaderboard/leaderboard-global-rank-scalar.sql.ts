import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { GLOBAL_SHARED_LOCATION_KEY } from '../due-management-ranking-scope-policy.service.js';

/**
 * leaderboard 行 SELECT で繰り返し使う globalRank 相関スカラー（ hydrate / row-selection と同一出力を保つ）。
 */
export function buildLeaderboardGlobalRankScalarSql(params: {
  siteScopedGlobalRankLocation: string;
  locationKey: string;
}): Prisma.Sql {
  const { siteScopedGlobalRankLocation, locationKey } = params;
  return Prisma.sql`(
    SELECT "globalRank"
    FROM "ProductionScheduleGlobalRowRank"
    WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "location" IN (${siteScopedGlobalRankLocation}, ${GLOBAL_SHARED_LOCATION_KEY}, ${locationKey})
    ORDER BY CASE
      WHEN "location" = ${siteScopedGlobalRankLocation} THEN 0
      WHEN "location" = ${GLOBAL_SHARED_LOCATION_KEY} THEN 1
      ELSE 2
    END ASC
    LIMIT 1
  )`;
}
