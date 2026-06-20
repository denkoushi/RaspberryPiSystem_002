import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  buildFkojunstProductionScheduleListVisibilityWhereSql,
} from './policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildLeaderboardProcessChangeResidualFilterWhereSql } from './leaderboard/leaderboard-process-change-residual.sql.js';
import type { ProcessChangeResidualMode } from './leaderboard/leaderboard-process-change-residual.types.js';
import { isProductionScheduleOrderSplitEnabled } from './order-split/production-schedule-order-split-feature.js';

type CountVisibleRowsParams = {
  baseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
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
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE ${baseWhere} ${queryWhere} ${buildFkojunstProductionScheduleListVisibilityWhereSql()} ${residualFilterSql}
  `;

  return rows[0]?.total ?? 0n;
}

/**
 * split 有効時の leaderboard display item 件数。
 * 分割済み親行は split 数、未分割親行は 1 件として数える。
 */
export async function countProductionScheduleDashboardVisibleDisplayItems(
  params: CountVisibleRowsParams
): Promise<bigint> {
  const { baseWhere, queryWhere, processChangeResidualMode, processChangeResidualStrongEvidenceKeys } = params;
  const residualFilterSql = buildLeaderboardProcessChangeResidualFilterWhereSql(
    processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys
  );
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT COALESCE(SUM(
      CASE
        WHEN COALESCE("split_counts"."split_count", 0) > 0 THEN "split_counts"."split_count"
        ELSE 1
      END
    ), 0)::bigint AS total
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN (
      SELECT "parentCsvDashboardRowId", COUNT(*)::int AS "split_count"
      FROM "ProductionScheduleOrderSplit"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      GROUP BY "parentCsvDashboardRowId"
    ) AS "split_counts"
      ON "split_counts"."parentCsvDashboardRowId" = "CsvDashboardRow"."id"
    WHERE ${baseWhere} ${queryWhere} ${buildFkojunstProductionScheduleListVisibilityWhereSql()} ${residualFilterSql}
  `;

  return rows[0]?.total ?? 0n;
}

/** leaderboard 向け可視件数（split 有効時は display item 単位）。 */
export async function countProductionScheduleDashboardVisibleLeaderboardUnits(
  params: CountVisibleRowsParams
): Promise<bigint> {
  if (isProductionScheduleOrderSplitEnabled()) {
    return countProductionScheduleDashboardVisibleDisplayItems(params);
  }
  return countProductionScheduleDashboardVisibleRows(params);
}
