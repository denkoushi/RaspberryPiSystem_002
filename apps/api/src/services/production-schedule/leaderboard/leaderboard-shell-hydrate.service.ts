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
  buildLeaderboardShellRankJoinContext
} from './leaderboard-shell-rank-join.sql.js';
import {
  chunkLeaderboardRowIdsForHydrate,
  normalizeLeaderboardDisplayRowIdScope
} from './leaderboard-display-row-scope.js';
import type { LeaderboardScheduleRowSql } from './leaderboard-schedule-row.types.js';
import { getLatestLeaderboardCanonicalRows, putLeaderboardCanonicalRows } from './leaderboard-canonical-row-cache.js';

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
  /** planning board が必要とする完了・補足・分割情報を同じ hydrate で返す */
  includePlanningDetails?: boolean;
  /** 順位の LATERAL JOIN が不要な全体 source 読みでは false にする */
  includeRank?: boolean;
  /** planning source は表示用 FK/status/processing JOIN を省き、必要列だけ hydrate する */
  planningSource?: boolean;
  /** cached identity rowsへの補足時はrowDataを再取得せずplanning detailだけ読む */
  planningDetailsOnly?: boolean;
}): Promise<LeaderboardScheduleRowSql[]> {
  const {
    orderedRowIdsChunk,
    locationKey,
    siteScopedGlobalRankLocation,
    leaderboardMaterializedBaseWhere,
    leaderboardShellListWhere,
    includePlanningDetails = false,
    includeRank = true,
    planningSource = false,
    planningDetailsOnly = false
  } = params;

  if (orderedRowIdsChunk.length === 0) {
    return [];
  }

  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const rowScopeWhere =
    leaderboardShellListWhere ?? Prisma.sql`${leaderboardMaterializedBaseWhere} ${visibilitySql}`;

  const rankJoins = includeRank
    ? buildLeaderboardShellRankJoinContext({ locationKey, siteScopedGlobalRankLocation })
    : {
        orderAssignmentJoin: Prisma.empty,
        globalRankJoin: Prisma.empty,
        processingOrderExpr: Prisma.sql`NULL::int`,
        globalRankExpr: Prisma.sql`NULL::int`
      };

  const planningDetailSelect = includePlanningDetails
    ? Prisma.sql`, jsonb_build_object(
        'detailUpdatedAt', GREATEST(
          COALESCE("CsvDashboardRow"."updatedAt", 'epoch'::timestamp),
          COALESCE("p"."updatedAt", 'epoch'::timestamp),
          COALESCE("ext"."updatedAt", 'epoch'::timestamp),
          COALESCE("n"."updatedAt", 'epoch'::timestamp),
          COALESCE("supplement"."updatedAt", 'epoch'::timestamp)
        ),
        'progressUpdatedAt', "p"."updatedAt",
        'externalUpdatedAt', "ext"."updatedAt",
        'dueDate', "n"."dueDate",
        'plannedQuantity', "supplement"."plannedQuantity",
        'plannedEndDate', "supplement"."plannedEndDate",
        'isCompleted', COALESCE("p"."isCompleted", FALSE),
        'isExternallyCompleted', COALESCE("ext"."isExternallyCompleted", FALSE),
        'splits', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', "split"."id",
              'splitQuantity', "split"."splitQuantity",
              'dueDate', "split"."dueDate",
              'updatedAt', "split"."updatedAt"
            ) ORDER BY "split"."splitNo"
          )
          FROM "ProductionScheduleOrderSplit" AS "split"
          WHERE "split"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND "split"."parentCsvDashboardRowId" = "CsvDashboardRow"."id"
        ), '[]'::jsonb)
      ) AS "planningDetail"`
    : Prisma.empty;

  const rowDataSelect = planningDetailsOnly
    ? Prisma.sql`NULL::jsonb`
    : planningSource
    ? Prisma.sql`jsonb_build_object(
        'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
        'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
        'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
        'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
        'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
        'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
        'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN'
      )`
    : Prisma.sql`jsonb_build_object(
        'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
        'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
        'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
        'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
        'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
        'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
        'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN',
        'FKOJUNST', ( ${buildFkojunstProductionScheduleListRowDataFkojunstSql()} ),
        'progress', (CASE WHEN ${buildProductionScheduleEffectiveCompletedSql()} THEN ${COMPLETED_PROGRESS_VALUE} ELSE '' END)
      )`;
  const noteSelect = planningSource || planningDetailsOnly
    ? Prisma.sql`NULL::text AS "note"`
    : Prisma.sql`NULLIF(TRIM("n"."note"), '') AS "note"`;
  const processingTypeSelect = planningSource || planningDetailsOnly
    ? Prisma.sql`NULL::text AS "processingType"`
    : Prisma.sql`COALESCE("pp"."processingType", "n"."processingType") AS "processingType"`;
  const planningOptionalJoins = planningSource || planningDetailsOnly
    ? Prisma.empty
    : Prisma.sql`
    LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
      ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}`;

  const orderedIdParts = orderedRowIdsChunk.map((id) => Prisma.sql`${id}`);
  const orderedIdArraySql = Prisma.sql`ARRAY[${Prisma.join(orderedIdParts)}]::text[]`;

  return prisma.$queryRaw<LeaderboardScheduleRowSql[]>`
    SELECT
      "CsvDashboardRow"."id",
      NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "seibanJoinKey",
      "CsvDashboardRow"."occurredAt",
      "CsvDashboardRow"."updatedAt",
      ${rowDataSelect} AS "rowData",
      ${rankJoins.processingOrderExpr} AS "processingOrder",
      ${rankJoins.globalRankExpr} AS "globalRank",
      ${noteSelect},
      ${processingTypeSelect},
      "n"."dueDate" AS "dueDate",
      "supplement"."plannedQuantity" AS "plannedQuantity",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      "supplement"."plannedEndDate" AS "plannedEndDate"
      ${planningDetailSelect}
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
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    ${planningOptionalJoins}
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
  includePlanningDetails?: boolean;
  includeRank?: boolean;
  planningSource?: boolean;
  planningDetailsOnly?: boolean;
  canonicalSourceGenerationToken?: string;
  canonicalSourceSiteKey?: string;
  /** planning source のように通常表示上限を超える bounded source read 用 */
  maxRows?: number;
}): Promise<LeaderboardScheduleRowSql[]> {
  const { locationKey, siteScopedGlobalRankLocation, leaderboardShellListWhere, includePlanningDetails, includeRank, planningSource, planningDetailsOnly, maxRows } = params;
  // Rank coverage is also consumed by the legacy board, so it must retain the
  // complete identity projection even when a planning caller requested a light
  // source shape. Planning-only reads use planningSource below.
  const effectivePlanningSource = includeRank === true ? false : planningSource;

  const uniqueOrdered = normalizeLeaderboardDisplayRowIdScope(params.orderedRowIds, maxRows);
  if (uniqueOrdered.length === 0) {
    return [];
  }

  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(
    prisma,
    params.leaderboardMaterializedBaseWhere
  );

  const canonicalSiteKey = params.canonicalSourceSiteKey ?? locationKey;
  const requiredCoverage = includePlanningDetails ? 'planning' as const : includeRank === false ? 'identity' as const : 'rank' as const;
  const cached = params.canonicalSourceGenerationToken
    ? getLatestLeaderboardCanonicalRows({
        siteKey: canonicalSiteKey,
        generationToken: params.canonicalSourceGenerationToken,
        rankContext: requiredCoverage === 'rank' ? `${locationKey}|${siteScopedGlobalRankLocation}` : 'none',
        rowIds: uniqueOrdered,
        coverage: requiredCoverage
      })
    : { generationToken: undefined, rows: [], missingIds: uniqueOrdered };
  if (cached.missingIds.length === 0) {
    const byId = new Map(cached.rows.map((row) => [row.id, row]));
    return uniqueOrdered.map((id) => byId.get(id)).filter((row): row is LeaderboardScheduleRowSql => row !== undefined);
  }
  const identityCached = params.canonicalSourceGenerationToken && requiredCoverage === 'rank'
    ? getLatestLeaderboardCanonicalRows({
        siteKey: canonicalSiteKey,
        generationToken: params.canonicalSourceGenerationToken,
        rankContext: `${locationKey}|${siteScopedGlobalRankLocation}`,
        rowIds: uniqueOrdered,
        coverage: 'identity'
      })
    : { rows: [] as LeaderboardScheduleRowSql[], missingIds: [] as string[] };
  const byId = new Map<string, LeaderboardScheduleRowSql>([
    ...identityCached.rows,
    ...cached.rows
  ].map((row) => [row.id, row]));
  const missingChunks = chunkLeaderboardRowIdsForHydrate(cached.missingIds);

  for (const chunk of missingChunks) {
    const batch = await fetchLeaderboardScheduleHydratedRowsSingleBatch({
      orderedRowIdsChunk: chunk,
      locationKey,
      siteScopedGlobalRankLocation,
      leaderboardMaterializedBaseWhere,
      leaderboardShellListWhere,
      includePlanningDetails,
      includeRank,
      planningSource: effectivePlanningSource,
      planningDetailsOnly
    });
    for (const row of batch) {
      const previous = byId.get(row.id);
      const previousData = previous?.rowData != null && typeof previous.rowData === 'object' && !Array.isArray(previous.rowData)
        ? previous.rowData as Record<string, unknown>
        : undefined;
      const currentData = row.rowData != null && typeof row.rowData === 'object' && !Array.isArray(row.rowData)
        ? row.rowData as Record<string, unknown>
        : undefined;
      byId.set(row.id, {
        ...row,
        ...(previousData != null && (currentData == null || Object.keys(currentData).length < Object.keys(previousData).length)
          ? { rowData: previous!.rowData }
          : {}),
        ...(row.note == null && previous?.note != null ? { note: previous.note } : {}),
        ...(row.processingType == null && previous?.processingType != null ? { processingType: previous.processingType } : {}),
        ...(row.processingOrder == null && previous?.processingOrder != null ? { processingOrder: previous.processingOrder } : {}),
        ...(row.globalRank == null && previous?.globalRank != null ? { globalRank: previous.globalRank } : {})
      });
    }
  }

  if (params.canonicalSourceGenerationToken) {
    putLeaderboardCanonicalRows({
      key: {
        siteKey: canonicalSiteKey,
        generationToken: params.canonicalSourceGenerationToken,
        rankContext: requiredCoverage === 'rank' ? `${locationKey}|${siteScopedGlobalRankLocation}` : 'none'
      },
      rows: [...byId.values()],
      coverage: requiredCoverage
    });
  }

  return uniqueOrdered.map((id) => byId.get(id)).filter((r): r is LeaderboardScheduleRowSql => r !== undefined);
}
