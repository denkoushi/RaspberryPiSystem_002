import { readScheduleRowPresence, buildScheduleRowPresenceCondition } from '../schedule-row-presence.service.js';
import { readSessakuPieceSets } from '../sessaku-pieces/piece-key.js';
import { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardCategory } from '@raspi-system/shared-types';
import { prisma } from '../../../lib/prisma.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from '../leaderboard/leaderboard-shell-hydrate.service.js';
import type { LeaderboardScheduleRowSql } from '../leaderboard/leaderboard-schedule-row.types.js';
import { loadLeaderboardCanonicalRows } from '../leaderboard/leaderboard-canonical-row-cache.js';
import { readGrindingPlanningBoardSnapshotGenerationToken } from '../leaderboard/leaderboard-shell-snapshot-generation.js';
import { prepareProductionScheduleDashboardFilters } from '../production-schedule-query/filters.js';
import { fetchLeaderboardPlanningScopedParentRowIds } from '../leaderboard/leaderboard-row-selection.service.js';
import { getResourceCategoryPolicy, normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import type { GrindingPlanningBoardProgressRow } from '../grinding-planning-board-projection-input.types.js';
import { resolveLeaderboardMaterializedWinnersWithGenerationCache } from '../leaderboard/leaderboard-materialized-winner-cache.js';
import { asRowData, dateValue, type PlanningSource, type RowDetail, type WinnerRow, uniqueFseibans, valueAsString } from './shared.js';

function planningDetailToRowDetail(row: LeaderboardScheduleRowSql): RowDetail {
  const detail = row.planningDetail;
  const updatedAt = row.updatedAt;
  if (!detail) {
    return {
      updatedAt,
      manualUpdatedAt: row.manualUpdatedAt, excelDueDate: row.excelDueDate, excelChangedAt: row.excelChangedAt,
      rowNotes: [{ dueDate: row.dueDate }],
      orderSupplements: [{ plannedQuantity: row.plannedQuantity, plannedEndDate: row.plannedEndDate }],
      productionScheduleProgress: { isCompleted: false, updatedAt: updatedAt ?? new Date(0) },
      productionScheduleExternalCompletion: { isExternallyCompleted: false, updatedAt: updatedAt ?? new Date(0) }
    };
  }
  return {
    updatedAt,
    manualUpdatedAt: row.manualUpdatedAt, excelDueDate: row.excelDueDate, excelChangedAt: row.excelChangedAt,
    rowNotes: [{ dueDate: dateValue(detail.dueDate) }],
    orderSupplements: [{ plannedQuantity: detail.plannedQuantity, plannedEndDate: dateValue(detail.plannedEndDate) }],
    productionScheduleProgress: { isCompleted: Boolean(detail.isCompleted), updatedAt: dateValue(detail.progressUpdatedAt) ?? new Date(0) },
    productionScheduleExternalCompletion: { isExternallyCompleted: Boolean(detail.isExternallyCompleted), updatedAt: dateValue(detail.externalUpdatedAt) ?? new Date(0) },
  };
}

export async function readPlanningSource(params: {
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  fseibans: readonly string[];
  leaderboardGenerationToken?: string;
}): Promise<PlanningSource> {
  const generationToken = params.leaderboardGenerationToken ?? await readGrindingPlanningBoardSnapshotGenerationToken();
  const { baseWhere, winnerRowIds } = await resolveLeaderboardMaterializedWinnersWithGenerationCache(prisma, { generationToken });
  const presence = await readScheduleRowPresence();
  const dashboardWhere = Prisma.sql`"CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND ${buildScheduleRowPresenceCondition(presence.cutoff)}`;
  const order = uniqueFseibans(params.fseibans);
  if (order.length === 0) {
    return { baseWhere, generationToken, rows: [], details: new Map(), progressRows: [] };
  }

  // SQL keeps the seiban/category filters and ID ordering; membership is
  // intersected in memory with the exact same generation's winners afterwards.
  const filters = await prepareProductionScheduleDashboardFilters({
    queryText: '',
    productNos: [],
    resourceCds: [],
    assignedOnlyCds: [],
    resourceCategory: params.category === 'all' ? undefined : params.category,
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: params.siteKey,
    siteKey: params.siteKey,
    planningFseibans: order
  });
  if (filters.kind === 'blocked_empty_search') {
    return { baseWhere, generationToken, rows: [], details: new Map(), progressRows: [] };
  }
  const orderedRowIds = await fetchLeaderboardPlanningScopedParentRowIds({
    leaderboardMaterializedBaseWhere: dashboardWhere,
    winnerRowIds,
    queryWhere: filters.queryWhere,
    completionFilter: 'all'
  });
  // Progress denominators are based on every registered process row. Keep the
  // displayed source category scoped, but use the same canonical ID selector
  // and bounded hydrate/cache path for the registered seiban progress source.
  const progressFilters = await prepareProductionScheduleDashboardFilters({
    queryText: '',
    productNos: [],
    resourceCds: [],
    assignedOnlyCds: [],
    resourceCategory: undefined,
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: params.siteKey,
    siteKey: params.siteKey,
    planningFseibans: order
  });
  const progressRowIds = progressFilters.kind === 'blocked_empty_search'
    ? []
    : await fetchLeaderboardPlanningScopedParentRowIds({
        leaderboardMaterializedBaseWhere: dashboardWhere,
        winnerRowIds,
        queryWhere: progressFilters.queryWhere,
        completionFilter: 'all'
      });
  const cacheKey = { siteKey: params.siteKey, generationToken };

  // Every hydrate ID comes from the winner-filtered selectors above. Under the
  // explicit ID predicate, dashboard-only WHERE is equivalent to baseWhere.

  const identityRows = await loadLeaderboardCanonicalRows({
    key: { ...cacheKey, rankContext: 'none' },
    rowIds: orderedRowIds,
    coverage: 'identity',
    load: async (missingIds) => {
      if (missingIds.length === 0) return [];
      return fetchLeaderboardScheduleHydratedRowsOrderedByIds({
        orderedRowIds: missingIds,
        locationKey: params.siteKey,
        siteScopedGlobalRankLocation: params.siteKey,
        leaderboardMaterializedBaseWhere: dashboardWhere,
        leaderboardShellListWhere: dashboardWhere,
        includeRank: false,
        canonicalSourceGenerationToken: generationToken,
        canonicalSourceSiteKey: params.siteKey,
        maxRows: missingIds.length
      });
    }
  });
  const plannedRows = await loadLeaderboardCanonicalRows({
    key: cacheKey,
    rowIds: orderedRowIds,
    coverage: 'planning',
    load: async (missingIds) => {
      if (missingIds.length === 0) return [];
      return fetchLeaderboardScheduleHydratedRowsOrderedByIds({
        orderedRowIds: missingIds,
        locationKey: params.siteKey,
        siteScopedGlobalRankLocation: params.siteKey,
        leaderboardMaterializedBaseWhere: dashboardWhere,
        leaderboardShellListWhere: dashboardWhere,
        includePlanningDetails: true,
        includeRank: false,
        planningSource: true,
        planningDetailsOnly: true,
        canonicalSourceGenerationToken: generationToken,
        canonicalSourceSiteKey: params.siteKey,
        maxRows: missingIds.length
      });
    }
  });
  const details = new Map(plannedRows.map((row) => [row.id, planningDetailToRowDetail(row)]));
  const progressRowsWithDetails = await loadLeaderboardCanonicalRows({
    key: cacheKey,
    rowIds: progressRowIds,
    coverage: 'planning',
    load: async (missingIds) => {
      if (missingIds.length === 0) return [];
      return fetchLeaderboardScheduleHydratedRowsOrderedByIds({
        orderedRowIds: missingIds,
        locationKey: params.siteKey,
        siteScopedGlobalRankLocation: params.siteKey,
        leaderboardMaterializedBaseWhere: dashboardWhere,
        leaderboardShellListWhere: dashboardWhere,
        includePlanningDetails: true,
        includeRank: false,
        canonicalSourceGenerationToken: generationToken,
        canonicalSourceSiteKey: params.siteKey,
        maxRows: missingIds.length
      });
    }
  });
  const progressDetails = new Map(progressRowsWithDetails.map((row) => [row.id, planningDetailToRowDetail(row)]));
  const progressPolicy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  return {
    baseWhere,
    generationToken,
    rows: identityRows.map((row) => ({ id: row.id, rowData: row.rowData, updatedAt: row.updatedAt })),
    details,
    pieceSets: await readSessakuPieceSets(prisma, identityRows),
    progressRows: buildPlanningProgressRows(progressRowsWithDetails, progressDetails, progressPolicy.cuttingExcludedResourceCds)
  };
}

function buildPlanningProgressRows(
  rows: readonly WinnerRow[],
  details: ReadonlyMap<string, RowDetail>,
  cuttingExcludedResourceCds: readonly string[]
): GrindingPlanningBoardProgressRow[] {
  return rows.flatMap((row) => {
    const detail = details.get(row.id);
    if (!detail) return [];
    const data = asRowData(row.rowData);
    const fhincd = valueAsString(data, 'FHINCD').trim().toUpperCase();
    const resourceCd = normalizeProductionScheduleResourceCd(valueAsString(data, 'FSIGENCD'));
    // Keep progress population aligned with the existing due-management rule:
    // machine rows and excluded cutting resources are not process parts.
    if (fhincd.startsWith('MH') || fhincd.startsWith('SH') || (resourceCd != null && cuttingExcludedResourceCds.includes(resourceCd))) return [];
    return [{
      rowId: row.id,
      fseiban: valueAsString(data, 'FSEIBAN'),
      productNo: valueAsString(data, 'ProductNo'),
      fhincd: valueAsString(data, 'FHINCD'),
      isCompleted: Boolean(detail.productionScheduleProgress?.isCompleted || detail.productionScheduleExternalCompletion?.isExternallyCompleted)
    }];
  });
}
