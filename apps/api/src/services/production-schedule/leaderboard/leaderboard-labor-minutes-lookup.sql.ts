import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildFkojunstProductionScheduleListVisibilityWhereSql } from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildLeaderboardProcessChangeResidualFilterWhereSql } from './leaderboard-process-change-residual.sql.js';
import type { ProcessChangeResidualMode } from './leaderboard-process-change-residual.types.js';

export type LeaderboardLaborMinutesLookupContext = {
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  processChangeResidualMode?: ProcessChangeResidualMode;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
};

/**
 * 順位ボード shell と同一の fkmail 可視性・残骸除外を人工数 lookup に適用する。
 * `queryWhere` の resource 条件は FSIGENCD=10 行と矛盾するため付与しない（lookup は ProductNo+FKOJUN で絞る）。
 */
export function buildLeaderboardLaborMinutesLookupWhereSql(
  context: LeaderboardLaborMinutesLookupContext
): Prisma.Sql {
  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const residualFilterSql = buildLeaderboardProcessChangeResidualFilterWhereSql(
    context.processChangeResidualMode,
    context.processChangeResidualStrongEvidenceKeys
  );
  return Prisma.sql`${context.leaderboardMaterializedBaseWhere} ${visibilitySql} ${residualFilterSql}`;
}

/** 可視性 WHERE が参照する fkmail / fkst JOIN（hydrate・count と同型）。 */
export function buildLeaderboardLaborMinutesLookupJoinSql(): Prisma.Sql {
  return Prisma.sql`
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
  `;
}
