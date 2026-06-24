import type { Prisma } from '@prisma/client';
import { Prisma as PrismaNamespace } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';
import type { ProductionScheduleRow } from '../production-schedule-query.service.js';
import { expandLeaderboardParentRowsForResponse } from './leaderboard-split-expansion.service.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from './leaderboard-shell-hydrate.service.js';
import { buildLeaderboardShellManualOrderBy } from './leaderboard-shell-row-projection.sql.js';
import { queryLeaderboardShellScheduleRows } from './leaderboard-shell-row-query.sql.js';
import { buildLeaderboardShellRankJoinContext } from './leaderboard-shell-rank-join.sql.js';
import type { LeaderboardScheduleRowSql } from './leaderboard-schedule-row.types.js';

const MAX_DISPLAY_ITEM_PREFIX_GAP_ITERATIONS = 32;

export type DisplayItemPrefixGapQuery =
  | { kind: 'atMost'; maxOrderInclusive: number }
  | { kind: 'between'; minOrderExclusive: number; maxOrderExclusive: number };

function mapLeaderboardSqlRowToProductionScheduleRow(row: LeaderboardScheduleRowSql): ProductionScheduleRow {
  return {
    id: row.id,
    seibanJoinKey: row.seibanJoinKey,
    occurredAt: row.occurredAt,
    rowData: row.rowData,
    processingOrder: row.processingOrder,
    globalRank: row.globalRank,
    actualPerPieceMinutes: null,
    note: row.note,
    processingType: row.processingType,
    dueDate: row.dueDate,
    plannedQuantity: row.plannedQuantity,
    plannedStartDate: row.plannedStartDate,
    plannedEndDate: row.plannedEndDate,
    customerName: null
  };
}

/** 初回 prefix の display item 順序に必要な manual 親行の取りこぼしを検出する。 */
export function collectDisplayItemPrefixGapQueries(params: {
  expandedDisplayItems: ReadonlyArray<Pick<ProductionScheduleRow, 'processingOrder'>>;
  pageSize: number;
}): DisplayItemPrefixGapQuery[] {
  const pageSize = Math.max(1, Math.floor(params.pageSize));
  const firstPage = params.expandedDisplayItems.slice(0, pageSize);
  const beyond = params.expandedDisplayItems.slice(pageSize);

  const firstPageOrders = firstPage
    .map((item) => item.processingOrder)
    .filter((order): order is number => order != null);
  const beyondOrders = beyond
    .map((item) => item.processingOrder)
    .filter((order): order is number => order != null);

  const queries: DisplayItemPrefixGapQuery[] = [];
  if (firstPageOrders.length > 0) {
    queries.push({ kind: 'atMost', maxOrderInclusive: Math.max(...firstPageOrders) });
  }
  if (firstPageOrders.length > 0 && beyondOrders.length > 0) {
    queries.push({
      kind: 'between',
      minOrderExclusive: Math.max(...firstPageOrders),
      maxOrderExclusive: Math.min(...beyondOrders)
    });
  }
  return queries;
}

function buildGapOrderNumberConstraintSql(
  orderNumberColumn: Prisma.Sql,
  gapQuery: DisplayItemPrefixGapQuery
): Prisma.Sql {
  if (gapQuery.kind === 'atMost') {
    return PrismaNamespace.sql`AND ${orderNumberColumn} <= ${gapQuery.maxOrderInclusive}`;
  }
  return PrismaNamespace.sql`AND ${orderNumberColumn} > ${gapQuery.minOrderExclusive} AND ${orderNumberColumn} < ${gapQuery.maxOrderExclusive}`;
}

function buildDisplayItemPrefixGapManualAssignmentExistsSql(params: {
  locationKey: string;
  gapQuery: DisplayItemPrefixGapQuery;
}): Prisma.Sql {
  const manualOrderFilter = buildGapOrderNumberConstraintSql(
    PrismaNamespace.sql`"ord_m"."orderNumber"`,
    params.gapQuery
  );
  const splitOrderFilter = buildGapOrderNumberConstraintSql(
    PrismaNamespace.sql`"sa_m"."orderNumber"`,
    params.gapQuery
  );

  return PrismaNamespace.sql`(
    EXISTS (
      SELECT 1
      FROM "ProductionScheduleOrderAssignment" AS "ord_m"
      WHERE "ord_m"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "ord_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "ord_m"."location" = ${params.locationKey}
          OR "ord_m"."siteKey" = ${params.locationKey}
        )
        ${manualOrderFilter}
    )
    ${
      isProductionScheduleOrderSplitEnabled()
        ? PrismaNamespace.sql`
    OR EXISTS (
      SELECT 1
      FROM "ProductionScheduleOrderSplitAssignment" AS "sa_m"
      INNER JOIN "ProductionScheduleOrderSplit" AS "s_m"
        ON "s_m"."id" = "sa_m"."splitId"
        AND "s_m"."parentCsvDashboardRowId" = "CsvDashboardRow"."id"
        AND "s_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      WHERE "sa_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "sa_m"."location" = ${params.locationKey}
          OR "sa_m"."siteKey" = ${params.locationKey}
        )
        ${splitOrderFilter}
    )`
        : PrismaNamespace.empty
    }
  )`;
}

async function findManualLeaderboardParentRowIdsForGapQuery(params: {
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  excludeParentRowIds: ReadonlySet<string>;
  gapQuery: DisplayItemPrefixGapQuery;
  leaderboardShellListWhere: Prisma.Sql;
}): Promise<string[]> {
  const exclude = [...params.excludeParentRowIds];
  const excludeSql =
    exclude.length > 0
      ? PrismaNamespace.sql`AND NOT ("CsvDashboardRow"."id" IN (${PrismaNamespace.join(
          exclude.map((id) => PrismaNamespace.sql`${id}`)
        )}))`
      : PrismaNamespace.empty;

  const rankJoins = buildLeaderboardShellRankJoinContext({
    locationKey: params.locationKey,
    siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation
  });
  const rows = await queryLeaderboardShellScheduleRows({
    rankJoins,
    whereSql: PrismaNamespace.sql`${params.leaderboardShellListWhere}
      AND ${buildDisplayItemPrefixGapManualAssignmentExistsSql({
        locationKey: params.locationKey,
        gapQuery: params.gapQuery
      })}
      ${excludeSql}`,
    orderBySql: buildLeaderboardShellManualOrderBy(rankJoins)
  });

  return rows.map((row) => row.id);
}

async function findMissingManualParentRowIdsForDisplayItemPrefix(params: {
  expandedDisplayItems: ProductionScheduleRow[];
  pageSize: number;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  excludeParentRowIds: ReadonlySet<string>;
  leaderboardShellListWhere: Prisma.Sql;
  leaderboardMaterializedBaseWhere: Prisma.Sql;
}): Promise<string[]> {
  const gapQueries = collectDisplayItemPrefixGapQueries({
    expandedDisplayItems: params.expandedDisplayItems,
    pageSize: params.pageSize
  });
  if (gapQueries.length === 0) {
    return [];
  }

  const candidateIds = new Set<string>();
  for (const gapQuery of gapQueries) {
    const ids = await findManualLeaderboardParentRowIdsForGapQuery({
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation,
      excludeParentRowIds: params.excludeParentRowIds,
      gapQuery,
      leaderboardShellListWhere: params.leaderboardShellListWhere
    });
    for (const id of ids) {
      candidateIds.add(id);
    }
  }
  if (candidateIds.size === 0) {
    return [];
  }

  const hydrated = await fetchLeaderboardScheduleHydratedRowsOrderedByIds({
    orderedRowIds: [...candidateIds],
    locationKey: params.locationKey,
    siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation,
    leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere,
    leaderboardShellListWhere: params.leaderboardShellListWhere
  });
  return hydrated.map((row) => row.id);
}

export type LeaderboardShellDisplayItemPrefixResult = {
  mergedPrefix: LeaderboardScheduleRowSql[];
  mergeFullyCompleted: boolean;
  expandedDisplayItems: ProductionScheduleRow[];
};

/**
 * split 有効時: 親行 prefix を display item 順序が確定するまで補完し、展開済み display item 列を返す。
 * split 無効時: 入力 prefix をそのまま展開するだけ。
 */
export async function resolveLeaderboardShellDisplayItemPrefix(params: {
  mergedPrefixInitial: LeaderboardScheduleRowSql[];
  mergeFullyCompletedInitial: boolean;
  pageSize: number;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  /** shell 一覧と同一の行スコープ（resourceCds / q / 残骸除外など） */
  leaderboardShellListWhere: Prisma.Sql;
}): Promise<LeaderboardShellDisplayItemPrefixResult> {
  const mergedPrefix = [...params.mergedPrefixInitial];
  const mergeFullyCompleted = params.mergeFullyCompletedInitial;

  if (!isProductionScheduleOrderSplitEnabled()) {
    const expandedDisplayItems = await expandLeaderboardParentRowsForResponse({
      rows: mergedPrefix.map(mapLeaderboardSqlRowToProductionScheduleRow),
      locationKey: params.locationKey
    });
    return { mergedPrefix, mergeFullyCompleted, expandedDisplayItems };
  }

  const fetchedParentIds = new Set(mergedPrefix.map((row) => row.id));

  for (let round = 0; round < MAX_DISPLAY_ITEM_PREFIX_GAP_ITERATIONS; round++) {
    const expandedDisplayItems = await expandLeaderboardParentRowsForResponse({
      rows: mergedPrefix.map(mapLeaderboardSqlRowToProductionScheduleRow),
      locationKey: params.locationKey
    });

    const missingParentIds = await findMissingManualParentRowIdsForDisplayItemPrefix({
      expandedDisplayItems,
      pageSize: params.pageSize,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation,
      excludeParentRowIds: fetchedParentIds,
      leaderboardShellListWhere: params.leaderboardShellListWhere,
      leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere
    });
    if (missingParentIds.length === 0) {
      return { mergedPrefix, mergeFullyCompleted, expandedDisplayItems };
    }

    const hydrated = await fetchLeaderboardScheduleHydratedRowsOrderedByIds({
      orderedRowIds: missingParentIds,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation,
      leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere,
      leaderboardShellListWhere: params.leaderboardShellListWhere
    });
    if (hydrated.length === 0) {
      return { mergedPrefix, mergeFullyCompleted, expandedDisplayItems };
    }

    for (const row of hydrated) {
      if (fetchedParentIds.has(row.id)) continue;
      fetchedParentIds.add(row.id);
      mergedPrefix.push(row);
    }
  }

  const expandedDisplayItems = await expandLeaderboardParentRowsForResponse({
    rows: mergedPrefix.map(mapLeaderboardSqlRowToProductionScheduleRow),
    locationKey: params.locationKey
  });
  return { mergedPrefix, mergeFullyCompleted, expandedDisplayItems };
}
