import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  buildFkojunstProductionScheduleListVisibilityWhereSql,
} from './policies/fkojunst-production-schedule-list-visibility.policy.js';
import {
  buildProductionScheduleCompletionFilterJoinSql,
  buildProductionScheduleCompletionFilterWhereSql,
  type ProductionScheduleCompletionFilter
} from './production-schedule-effective-completion.sql.js';
import { buildLeaderboardProcessChangeResidualFilterWhereSql } from './leaderboard/leaderboard-process-change-residual.sql.js';
import type { ProcessChangeResidualMode } from './leaderboard/leaderboard-process-change-residual.types.js';

type CountVisibleRowsParams = {
  baseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  hasDueDateOnly?: boolean;
  completionFilter?: ProductionScheduleCompletionFilter;
  processChangeResidualMode?: ProcessChangeResidualMode;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
};

/**
 * `listProductionScheduleRows` の `COUNT(*)` と同一の可視行条件（Fkojunst 可視 WHERE 含む）。
 * `responseProfile` に依存せず full / leaderboard 共用。
 */
export async function countProductionScheduleDashboardVisibleRows(
  params: CountVisibleRowsParams
): Promise<bigint> {
  const { baseWhere, queryWhere, processChangeResidualMode, processChangeResidualStrongEvidenceKeys } = params;
  const residualFilterSql = buildLeaderboardProcessChangeResidualFilterWhereSql(
    processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys
  );
  const completionJoinSql = buildProductionScheduleCompletionFilterJoinSql(params.completionFilter);
  const completionFilterSql = buildProductionScheduleCompletionFilterWhereSql(params.completionFilter);
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    ${completionJoinSql}
    WHERE ${baseWhere} ${queryWhere} ${buildFkojunstProductionScheduleListVisibilityWhereSql()} ${completionFilterSql} ${residualFilterSql}
  `;

  return rows[0]?.total ?? 0n;
}

/** leaderboard 向け可視親行件数。 */
export async function countProductionScheduleDashboardVisibleLeaderboardUnits(
  params: CountVisibleRowsParams
): Promise<bigint> {
  return countProductionScheduleDashboardVisibleRows(params);
}
