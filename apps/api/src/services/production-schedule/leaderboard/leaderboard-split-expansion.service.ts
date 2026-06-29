import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from '../leaderboard/leaderboard-shell-hydrate.service.js';
import type { LeaderboardScheduleRowSql } from '../leaderboard/leaderboard-schedule-row.types.js';
import type { Prisma } from '@prisma/client';

import {
  buildDisplayItemIdsByParentRowId,
  expandOrderedDisplayItemIdsFromParentRowIds,
  expandProductionScheduleRowsForOrderSplits,
  filterProductionScheduleDisplayRowsByDueDate,
  hydrateDisplayItemsFromParentRows,
  resolveHydrateSourceRowIdsFromDisplayItemIds
} from '../order-split/production-schedule-order-split.service.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';
import type { ProductionScheduleRow } from '../production-schedule-query.service.js';
import {
  collectSplitIdsFromDisplayItemIds,
  resolveUniqueSourceRowIdsFromDisplayItemIds,
  type DisplayItemId,
  type SourceRowId
} from '../order-split/leaderboard-display-item-id.js';

function mapHydratedSqlRowToProductionScheduleRow(row: LeaderboardScheduleRowSql): ProductionScheduleRow {
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

export async function expandLeaderboardParentRowsForResponse(params: {
  rows: ProductionScheduleRow[];
  locationKey: string;
  hasDueDateOnly?: boolean;
}): Promise<ProductionScheduleRow[]> {
  const expanded = await expandProductionScheduleRowsForOrderSplits({
    rows: params.rows,
    locationKey: params.locationKey,
    enabled: isProductionScheduleOrderSplitEnabled()
  });
  return filterProductionScheduleDisplayRowsByDueDate(expanded, params.hasDueDateOnly === true);
}

export async function expandLeaderboardParentRowIdsForSnapshot(params: {
  parentRows: ProductionScheduleRow[];
  locationKey: string;
  hasDueDateOnly?: boolean;
}): Promise<DisplayItemId[]> {
  if (params.hasDueDateOnly) {
    const expanded = await expandLeaderboardParentRowsForResponse({
      rows: params.parentRows,
      locationKey: params.locationKey,
      hasDueDateOnly: true
    });
    return expanded.map((row) => row.id);
  }

  const parentProcessingOrderByRowId = new Map(
    params.parentRows.map((row) => [row.id, row.processingOrder ?? null] as const)
  );
  return expandOrderedDisplayItemIdsFromParentRowIds({
    parentRowIds: params.parentRows.map((row) => row.id),
    parentProcessingOrderByRowId,
    locationKey: params.locationKey,
    enabled: isProductionScheduleOrderSplitEnabled()
  });
}

export async function fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds(params: {
  orderedDisplayItemIds: readonly DisplayItemId[];
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  leaderboardMaterializedBaseWhere?: Prisma.Sql;
  leaderboardShellListWhere?: Prisma.Sql;
}): Promise<ProductionScheduleRow[]> {
  const enabled = isProductionScheduleOrderSplitEnabled();
  const sourceRowIds = await resolveHydrateSourceRowIdsFromDisplayItemIds(params.orderedDisplayItemIds);

  if (sourceRowIds.length === 0) {
    return [];
  }

  const hydratedParentRows = await fetchLeaderboardScheduleHydratedRowsOrderedByIds({
    orderedRowIds: sourceRowIds,
    locationKey: params.locationKey,
    siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation,
    leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere,
    leaderboardShellListWhere: params.leaderboardShellListWhere
  });

  const parentProductionRows = hydratedParentRows.map(mapHydratedSqlRowToProductionScheduleRow);

  return hydrateDisplayItemsFromParentRows({
    orderedDisplayItemIds: params.orderedDisplayItemIds,
    hydratedParentRows: parentProductionRows,
    locationKey: params.locationKey,
    enabled
  });
}

export async function resolveParentRowIdsExcludedFromLeaderboardContinuation(
  snapshotDisplayItemIds: readonly DisplayItemId[]
): Promise<string[]> {
  return resolveHydrateSourceRowIdsFromDisplayItemIds(snapshotDisplayItemIds);
}

function normalizeExcludeDisplayItemIdSet(excludeDisplayItemIds: readonly DisplayItemId[]): Set<string> {
  return new Set(
    excludeDisplayItemIds.map((id) => id.trim()).filter((id) => id.length > 0)
  );
}

async function resolveParentRowIdsReferencedByExcludedSplits(
  excludeDisplayItemIds: readonly DisplayItemId[]
): Promise<SourceRowId[]> {
  const splitIds = collectSplitIdsFromDisplayItemIds(excludeDisplayItemIds);
  if (splitIds.length === 0) {
    return [];
  }

  const splits = await prisma.productionScheduleOrderSplit.findMany({
    where: { id: { in: splitIds }, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    select: { parentCsvDashboardRowId: true }
  });

  return [...new Set(splits.map((split) => split.parentCsvDashboardRowId))];
}

/**
 * snapshot なし continue: 返却済み display item から、SQL 除外すべき親行 ID を導出する。
 * 親行 UUID が直接含まれるか、当該親の split がすべて返却済みのときのみ親を除外する。
 */
export async function resolveFullyExcludedParentRowIdsForLegacyContinue(params: {
  excludeDisplayItemIds: readonly DisplayItemId[];
  locationKey: string;
}): Promise<SourceRowId[]> {
  const excludeSet = normalizeExcludeDisplayItemIdSet(params.excludeDisplayItemIds);
  const fullyExcluded = new Set(resolveUniqueSourceRowIdsFromDisplayItemIds(params.excludeDisplayItemIds));

  if (!isProductionScheduleOrderSplitEnabled()) {
    return [...fullyExcluded];
  }

  const parentIdsFromSplits = await resolveParentRowIdsReferencedByExcludedSplits(params.excludeDisplayItemIds);
  if (parentIdsFromSplits.length === 0) {
    return [...fullyExcluded];
  }

  const displayIdsByParent = await buildDisplayItemIdsByParentRowId({
    parentRowIds: parentIdsFromSplits,
    locationKey: params.locationKey,
    enabled: true
  });
  for (const parentId of parentIdsFromSplits) {
    if (fullyExcluded.has(parentId)) continue;
    const allDisplayIds = displayIdsByParent.get(parentId) ?? [];
    if (allDisplayIds.length > 0 && allDisplayIds.every((id) => excludeSet.has(id))) {
      fullyExcluded.add(parentId);
    }
  }

  return [...fullyExcluded];
}

async function resolvePartiallyReturnedParentRowIds(
  excludeDisplayItemIds: readonly DisplayItemId[],
  locationKey: string
): Promise<SourceRowId[]> {
  const excludeSet = normalizeExcludeDisplayItemIdSet(excludeDisplayItemIds);
  const parentIdsFromSplits = await resolveParentRowIdsReferencedByExcludedSplits(excludeDisplayItemIds);
  if (parentIdsFromSplits.length === 0) {
    return [];
  }

  const displayIdsByParent = await buildDisplayItemIdsByParentRowId({
    parentRowIds: parentIdsFromSplits,
    locationKey,
    enabled: true
  });
  const partial: SourceRowId[] = [];

  for (const parentId of parentIdsFromSplits) {
    const allDisplayIds = displayIdsByParent.get(parentId) ?? [];
    const hasExcluded = allDisplayIds.some((id) => excludeSet.has(id));
    const hasRemaining = allDisplayIds.some((id) => !excludeSet.has(id));
    if (hasExcluded && hasRemaining) {
      partial.push(parentId);
    }
  }

  return partial;
}

/**
 * snapshot なし continue: 一部だけ返却済みの親行 ID（SQL 側で再取得しないための除外用）。
 */
export async function resolvePartiallyReturnedParentRowIdsForLegacyContinue(params: {
  excludeDisplayItemIds: readonly DisplayItemId[];
  locationKey: string;
}): Promise<SourceRowId[]> {
  if (!isProductionScheduleOrderSplitEnabled()) {
    return [];
  }

  return resolvePartiallyReturnedParentRowIds(params.excludeDisplayItemIds, params.locationKey);
}

/**
 * snapshot なし continue: 一部だけ返却済みの親行から、残りの display item を hydrate する。
 */
export async function fetchPartiallyReturnedDisplayItemsForLegacyContinue(params: {
  excludeDisplayItemIds: readonly DisplayItemId[];
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  leaderboardMaterializedBaseWhere?: Prisma.Sql;
}): Promise<ProductionScheduleRow[]> {
  if (!isProductionScheduleOrderSplitEnabled()) {
    return [];
  }

  const excludeSet = normalizeExcludeDisplayItemIdSet(params.excludeDisplayItemIds);
  const partialParentIds = await resolvePartiallyReturnedParentRowIds(
    params.excludeDisplayItemIds,
    params.locationKey
  );
  if (partialParentIds.length === 0) {
    return [];
  }

  const displayIdsByParent = await buildDisplayItemIdsByParentRowId({
    parentRowIds: partialParentIds,
    locationKey: params.locationKey,
    enabled: true
  });
  const remainingDisplayIds: DisplayItemId[] = [];
  for (const parentId of partialParentIds) {
    const allDisplayIds = displayIdsByParent.get(parentId) ?? [];
    for (const id of allDisplayIds) {
      if (!excludeSet.has(id)) {
        remainingDisplayIds.push(id);
      }
    }
  }

  if (remainingDisplayIds.length === 0) {
    return [];
  }

  return fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds({
    orderedDisplayItemIds: remainingDisplayIds,
    locationKey: params.locationKey,
    siteScopedGlobalRankLocation: params.siteScopedGlobalRankLocation,
    leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere
  });
}
