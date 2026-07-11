import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  buildFkojunstProductionScheduleListVisibilityWhereSql,
} from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import type { ProductionScheduleListParams, ProductionScheduleRow } from '../production-schedule-query.service.js';
import { prepareProductionScheduleDashboardFilters } from '../production-schedule-query.service.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import {
  buildProcessChangeResidualStrongEvidenceKey,
  materializeProcessChangeResidualStrongEvidence,
  parseProcessChangeResidualStrongEvidenceKey,
  type ProcessChangeResidualStrongEvidenceMaterialization,
} from './leaderboard-process-change-residual.materialization.js';
import type { ProcessChangeResidualStrongEvidenceKey } from './leaderboard-process-change-residual.keys.js';
import { buildLeaderboardProcessChangeResidualKeyPresentSql } from './leaderboard-process-change-residual.sql.js';
import {
  LEADERBOARD_PROCESS_CHANGE_RESIDUAL_REPRESENTATIVE_LIMIT,
  type ProcessChangeResidualEvidence,
} from './leaderboard-process-change-residual.types.js';
import { buildLeaderboardShellRankJoinContext } from './leaderboard-shell-rank-join.sql.js';
import {
  buildLeaderboardShellFillerOrderBy,
  buildLeaderboardShellRowAuxiliaryJoins,
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

function buildResidualKeyRows(
  strongEvidenceKeys: ReadonlySet<string>
): ProcessChangeResidualStrongEvidenceKey[] {
  const keyRows: ProcessChangeResidualStrongEvidenceKey[] = [];
  for (const key of strongEvidenceKeys) {
    const parsed = parseProcessChangeResidualStrongEvidenceKey(key);
    if (parsed == null) continue;
    keyRows.push(parsed);
  }
  return keyRows;
}

function buildResidualKeyValuesSql(keyRows: readonly ProcessChangeResidualStrongEvidenceKey[]): Prisma.Sql {
  return Prisma.join(
    keyRows.map((keyRow) =>
      Prisma.sql`(${keyRow.productNo}::text, ${keyRow.fkojun}::text, ${keyRow.resourceCd.toUpperCase()}::text)`
    )
  );
}

function buildResidualKeyJoinSql(): Prisma.Sql {
  return Prisma.sql`
    INNER JOIN "residual_keys" AS "rk"
      ON NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'ProductNo'), '') = "rk"."productNo"
      AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN'), '') = "rk"."fkojun"
      AND UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) = "rk"."resourceCd"
  `;
}

async function countResidualRowsByKeys(params: {
  baseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  keyRows: readonly ProcessChangeResidualStrongEvidenceKey[];
}): Promise<bigint> {
  if (params.keyRows.length === 0) {
    return 0n;
  }

  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const keyPresentSql = buildLeaderboardProcessChangeResidualKeyPresentSql();
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    WITH "residual_keys"("productNo", "fkojun", "resourceCd") AS (
      VALUES ${buildResidualKeyValuesSql(params.keyRows)}
    )
    SELECT COUNT(*)::bigint AS total
    FROM "CsvDashboardRow"
    ${buildResidualKeyJoinSql()}
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE ${params.baseWhere} ${params.queryWhere} ${visibilitySql}
      AND "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${keyPresentSql}
  `;

  return rows[0]?.total ?? 0n;
}

async function queryResidualRepresentativeRows(params: {
  baseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  limit: number;
  keyRows: readonly ProcessChangeResidualStrongEvidenceKey[];
}): Promise<LeaderboardScheduleRowSql[]> {
  if (params.keyRows.length === 0) {
    return [];
  }

  const rankJoins = buildLeaderboardShellRankJoinContext({
    locationKey: params.locationKey,
    siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation,
  });
  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const keyPresentSql = buildLeaderboardProcessChangeResidualKeyPresentSql();
  const whereSql = Prisma.sql`
    ${params.baseWhere} ${params.queryWhere} ${visibilitySql}
    AND "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND ${keyPresentSql}
  `;
  const limitSql = Prisma.sql`LIMIT ${Math.max(1, Math.floor(params.limit))}`;

  return prisma.$queryRaw<LeaderboardScheduleRowSql[]>`
    WITH "residual_keys"("productNo", "fkojun", "resourceCd") AS (
      VALUES ${buildResidualKeyValuesSql(params.keyRows)}
    )
    SELECT ${buildLeaderboardShellRowSelectList(rankJoins)}
    FROM "CsvDashboardRow"
    ${buildResidualKeyJoinSql()}
    ${buildLeaderboardShellRowAuxiliaryJoins(rankJoins)}
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
  const residualKeyRows = buildResidualKeyRows(strongEvidenceKeys);
  if (residualKeyRows.length === 0) {
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

  const totalBig = await countResidualRowsByKeys({
    baseWhere: leaderboardMaterializedBaseWhere,
    queryWhere,
    keyRows: residualKeyRows,
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
    keyRows: residualKeyRows,
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
