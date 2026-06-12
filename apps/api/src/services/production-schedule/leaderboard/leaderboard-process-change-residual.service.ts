import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  buildFkojunstProductionScheduleListVisibilityWhereSql,
} from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { countProductionScheduleDashboardVisibleRows } from '../production-schedule-list-count.service.js';
import type { ProductionScheduleListParams, ProductionScheduleRow } from '../production-schedule-query.service.js';
import { prepareProductionScheduleDashboardFilters } from '../production-schedule-query.service.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import {
  buildProcessChangeResidualStrongEvidenceKey,
  materializeProcessChangeResidualStrongEvidence,
  type ProcessChangeResidualStrongEvidenceMaterialization,
} from './leaderboard-process-change-residual.materialization.js';
import { buildLeaderboardProcessChangeResidualFilterWhereSql } from './leaderboard-process-change-residual.sql.js';
import {
  LEADERBOARD_PROCESS_CHANGE_RESIDUAL_REPRESENTATIVE_LIMIT,
  type ProcessChangeResidualEvidence,
} from './leaderboard-process-change-residual.types.js';
import { buildLeaderboardShellRankJoinContext } from './leaderboard-shell-rank-join.sql.js';
import {
  buildLeaderboardShellFillerOrderBy,
  buildLeaderboardShellRowFromJoins,
  buildLeaderboardShellRowSelectList,
} from './leaderboard-shell-row-projection.sql.js';
import type { LeaderboardScheduleRowSql } from './leaderboard-schedule-row.types.js';

type ResidualSummaryParams = Omit<ProductionScheduleListParams, 'page' | 'pageSize' | 'responseProfile'> & {
  representativeLimit?: number;
  leaderboardMaterializedBaseWhere?: Prisma.Sql;
  processChangeResidualMaterialization?: ProcessChangeResidualStrongEvidenceMaterialization;
};

function readRowKeyFields(rowData: Prisma.JsonValue | null | undefined): {
  productNo: string;
  fkojun: string;
  resourceCd: string;
} | null {
  const data = (rowData ?? {}) as Record<string, unknown>;
  const productNo = typeof data.ProductNo === 'string' ? data.ProductNo.trim() : '';
  const fkojun = typeof data.FKOJUN === 'string' ? data.FKOJUN.trim() : '';
  const resourceCd = typeof data.FSIGENCD === 'string' ? data.FSIGENCD.trim().toUpperCase() : '';
  if (productNo.length === 0 || fkojun.length === 0 || resourceCd.length === 0) {
    return null;
  }
  return { productNo, fkojun, resourceCd };
}

function mapSqlRowToProductionScheduleRow(row: LeaderboardScheduleRowSql): ProductionScheduleRow {
  return {
    ...row,
    actualPerPieceMinutes: null,
    customerName: null,
  };
}

async function queryResidualRepresentativeRows(params: {
  baseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  limit: number;
  strongEvidenceKeys: ReadonlySet<string>;
}): Promise<LeaderboardScheduleRowSql[]> {
  const rankJoins = buildLeaderboardShellRankJoinContext({
    locationKey: params.locationKey,
    siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation,
  });
  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const residualOnlySql = buildLeaderboardProcessChangeResidualFilterWhereSql('only', params.strongEvidenceKeys);
  const whereSql = Prisma.sql`${params.baseWhere} ${params.queryWhere} ${visibilitySql} ${residualOnlySql}`;
  const limitSql = Prisma.sql`LIMIT ${Math.max(1, Math.floor(params.limit))}`;

  return prisma.$queryRaw<LeaderboardScheduleRowSql[]>`
    SELECT ${buildLeaderboardShellRowSelectList(rankJoins)}
    ${buildLeaderboardShellRowFromJoins(rankJoins)}
    WHERE ${whereSql}
    ORDER BY ${buildLeaderboardShellFillerOrderBy()}
    ${limitSql}
  `;
}

export async function fetchLeaderboardProcessChangeResidualSummary(
  params: ResidualSummaryParams
): Promise<{
  processChangeResidualTotal: number;
  processChangeResidualRows: Array<
    ProductionScheduleRow & {
      processChangeResidualSuspected: true;
      processChangeResidualEvidence: ProcessChangeResidualEvidence;
    }
  >;
  processChangeResidualRepresentativeLimit: number;
}> {
  const representativeLimit =
    params.representativeLimit ?? LEADERBOARD_PROCESS_CHANGE_RESIDUAL_REPRESENTATIVE_LIMIT;

  const filters = await prepareProductionScheduleDashboardFilters(params);
  if (filters.kind === 'blocked_empty_search') {
    return {
      processChangeResidualTotal: 0,
      processChangeResidualRows: [],
      processChangeResidualRepresentativeLimit: representativeLimit,
    };
  }

  const materialization =
    params.processChangeResidualMaterialization ??
    (await materializeProcessChangeResidualStrongEvidence(prisma));
  const strongEvidenceKeys = materialization.keys;

  if (strongEvidenceKeys.size === 0) {
    return {
      processChangeResidualTotal: 0,
      processChangeResidualRows: [],
      processChangeResidualRepresentativeLimit: representativeLimit,
    };
  }

  const { queryWhere, siteScopedGlobalRankLocation } = filters;
  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(
    prisma,
    params.leaderboardMaterializedBaseWhere
  );

  const totalBig = await countProductionScheduleDashboardVisibleRows({
    baseWhere: leaderboardMaterializedBaseWhere,
    queryWhere,
    processChangeResidualMode: 'only',
    processChangeResidualStrongEvidenceKeys: strongEvidenceKeys,
  });
  const processChangeResidualTotal = Number(totalBig);

  if (processChangeResidualTotal === 0) {
    return {
      processChangeResidualTotal: 0,
      processChangeResidualRows: [],
      processChangeResidualRepresentativeLimit: representativeLimit,
    };
  }

  const representativeSqlRows = await queryResidualRepresentativeRows({
    baseWhere: leaderboardMaterializedBaseWhere,
    queryWhere,
    locationKey: params.locationKey,
    siteScopedGlobalRankLocation,
    limit: representativeLimit,
    strongEvidenceKeys,
  });

  const processChangeResidualRows = representativeSqlRows.flatMap((sqlRow) => {
    const keys = readRowKeyFields(sqlRow.rowData);
    if (keys == null) {
      return [];
    }
    const evidence = materialization.evidenceByKey.get(buildProcessChangeResidualStrongEvidenceKey(keys));
    if (evidence == null) {
      return [];
    }
    return [
      {
        ...mapSqlRowToProductionScheduleRow(sqlRow),
        processChangeResidualSuspected: true as const,
        processChangeResidualEvidence: evidence,
      },
    ];
  });

  return {
    processChangeResidualTotal,
    processChangeResidualRows,
    processChangeResidualRepresentativeLimit: representativeLimit,
  };
}

export { materializeProcessChangeResidualStrongEvidence };
