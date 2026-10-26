import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type { GrindingPlanningBoardCategory } from '@raspi-system/shared-types';
import { prisma } from '../../../lib/prisma.js';
import { chunkLeaderboardRowIdsForHydrate } from '../leaderboard/leaderboard-display-row-scope.js';
import { fetchLeaderboardScheduleHydratedRowsOrderedByIds } from '../leaderboard/leaderboard-shell-hydrate.service.js';
import type { LeaderboardScheduleRowSql } from '../leaderboard/leaderboard-schedule-row.types.js';
import { loadLeaderboardCanonicalRows } from '../leaderboard/leaderboard-canonical-row-cache.js';
import { readGrindingPlanningBoardSnapshotGenerationToken } from '../leaderboard/leaderboard-shell-snapshot-generation.js';
import { prepareProductionScheduleDashboardFilters } from '../production-schedule-query/filters.js';
import { fetchLeaderboardPlanningScopedParentRowIds } from '../leaderboard/leaderboard-row-selection.service.js';
import { getResourceCategoryPolicy, normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { isSendaiResourceGroupCd } from '../resource-master.service.js';
import { type GrindingPlanningBoardProjectionRanks, type GrindingPlanningBoardProgressRow } from '../grinding-planning-board-projection.js';
import { resolveLeaderboardMaterializedBaseWhereWithGenerationCache } from '../leaderboard/leaderboard-materialized-winner-cache.js';
import { resolveLeaderboardMaterializedBaseWhere } from '../row-resolver/index.js';
import { asRowData, dateValue, isCategoryResource, type DbClient, type PlanningSource, type RankRow, type RowDetail, type SplitRankRow, type WinnerRow, uniqueFseibans, valueAsString } from './shared.js';


export async function readWinnerRowsByIds(client: DbClient, rowIds: readonly string[]): Promise<WinnerRow[]> {
  return readWinnerRowsScoped(client, rowIds);
}

export async function readWinnerRowsByFseibans(client: DbClient, fseibans: readonly string[]): Promise<WinnerRow[]> {
  const values = [...new Set(fseibans.map((value) => value.trim()).filter(Boolean))];
  if (values.length === 0) return [];
  const baseWhere = await resolveLeaderboardMaterializedBaseWhere(client);
  return client.$queryRaw<WinnerRow[]>(Prisma.sql`
    SELECT "CsvDashboardRow"."id", "CsvDashboardRow"."rowData", "CsvDashboardRow"."updatedAt"
    FROM "CsvDashboardRow"
    WHERE ${baseWhere}
      AND "CsvDashboardRow"."rowData"->>'FSEIBAN' = ANY(${values}::text[])
  `);
}

/** Matches the logical-key identity (`COALESCE(raw, '')`) exactly, unlike the trimmed FSEIBAN lookup. */
export async function readWinnerRowsByLogicalKeyFseibans(client: DbClient, fseibans: readonly string[]): Promise<WinnerRow[]> {
  const values = [...new Set(fseibans)];
  if (values.length === 0) return [];
  const baseWhere = await resolveLeaderboardMaterializedBaseWhere(client);
  return client.$queryRaw<WinnerRow[]>(Prisma.sql`
    SELECT "CsvDashboardRow"."id", "CsvDashboardRow"."rowData", "CsvDashboardRow"."updatedAt"
    FROM "CsvDashboardRow"
    WHERE ${baseWhere}
      AND COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '') = ANY(${values}::text[])
  `);
}

async function readWinnerRowsScoped(client: DbClient, rowIds?: readonly string[]): Promise<WinnerRow[]> {
  const baseWhere = await resolveLeaderboardMaterializedBaseWhere(client);
  const scope = rowIds === undefined
    ? Prisma.empty
    : rowIds.length === 0
      ? Prisma.sql`AND FALSE`
      : Prisma.sql`AND "CsvDashboardRow"."id"::text = ANY(${[...new Set(rowIds)]}::text[])`;
  return client.$queryRaw<WinnerRow[]>(Prisma.sql`
    SELECT "CsvDashboardRow"."id", "CsvDashboardRow"."rowData", "CsvDashboardRow"."updatedAt"
    FROM "CsvDashboardRow"
    WHERE ${baseWhere} ${scope}
  `);
}

function planningDetailToRowDetail(row: LeaderboardScheduleRowSql): RowDetail {
  const detail = row.planningDetail;
  const updatedAt = row.updatedAt;
  if (!detail) {
    return {
      updatedAt,
      rowNotes: [{ dueDate: row.dueDate }],
      orderSupplements: [{ plannedQuantity: row.plannedQuantity, plannedEndDate: row.plannedEndDate }],
      productionScheduleProgress: { isCompleted: false, updatedAt: updatedAt ?? new Date(0) },
      productionScheduleExternalCompletion: { isExternallyCompleted: false, updatedAt: updatedAt ?? new Date(0) },
      orderSplits: []
    };
  }
  return {
    updatedAt,
    rowNotes: [{ dueDate: dateValue(detail.dueDate) }],
    orderSupplements: [{ plannedQuantity: detail.plannedQuantity, plannedEndDate: dateValue(detail.plannedEndDate) }],
    productionScheduleProgress: { isCompleted: Boolean(detail.isCompleted), updatedAt: dateValue(detail.progressUpdatedAt) ?? new Date(0) },
    productionScheduleExternalCompletion: { isExternallyCompleted: Boolean(detail.isExternallyCompleted), updatedAt: dateValue(detail.externalUpdatedAt) ?? new Date(0) },
    orderSplits: detail.splits.flatMap((split) => {
      const splitUpdatedAt = dateValue(split.updatedAt);
      if (!splitUpdatedAt) return [];
      return [{ id: split.id, splitQuantity: split.splitQuantity, dueDate: dateValue(split.dueDate), updatedAt: splitUpdatedAt }];
    })
  };
}

export async function readPlanningSource(params: {
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  fseibans: readonly string[];
  leaderboardGenerationToken?: string;
}): Promise<PlanningSource> {
  const generationToken = params.leaderboardGenerationToken ?? await readGrindingPlanningBoardSnapshotGenerationToken();
  const baseWhere = await resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma, { generationToken });
  const order = uniqueFseibans(params.fseibans);
  if (order.length === 0) {
    return { baseWhere, generationToken, rows: [], details: new Map(), progressRows: [] };
  }

  // Reuse the existing winner/category selection path, but apply the registered
  // seiban scope before reading any parent rows. This deliberately selects IDs
  // only; full row hydration is delegated to the shared canonical cache path.
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
    leaderboardMaterializedBaseWhere: baseWhere,
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
        leaderboardMaterializedBaseWhere: baseWhere,
        queryWhere: progressFilters.queryWhere,
        completionFilter: 'all'
      });
  const cacheKey = { siteKey: params.siteKey, generationToken };

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
        leaderboardMaterializedBaseWhere: baseWhere,
        leaderboardShellListWhere: baseWhere,
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
        leaderboardMaterializedBaseWhere: baseWhere,
        leaderboardShellListWhere: baseWhere,
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
        leaderboardMaterializedBaseWhere: baseWhere,
        leaderboardShellListWhere: baseWhere,
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

export async function readRowDetails(client: DbClient, rowIds: readonly string[]): Promise<Map<string, RowDetail>> {
  if (rowIds.length === 0) return new Map();
  const details = new Map<string, RowDetail>();
  for (const chunk of chunkLeaderboardRowIdsForHydrate([...new Set(rowIds)])) {
    const rows = await client.csvDashboardRow.findMany({
      where: { id: { in: chunk }, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: {
        id: true,
        updatedAt: true,
        rowNotes: { where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, orderBy: { updatedAt: 'desc' }, take: 1, select: { dueDate: true } },
        orderSupplements: { where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { plannedQuantity: true, plannedEndDate: true } },
        productionScheduleProgress: { select: { isCompleted: true, updatedAt: true } },
        productionScheduleExternalCompletion: { select: { isExternallyCompleted: true, updatedAt: true } },
        orderSplits: { where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { id: true, splitQuantity: true, dueDate: true, updatedAt: true }, orderBy: { splitNo: 'asc' } }
      }
    });
    for (const detail of rows) details.set(detail.id, detail as RowDetail);
  }
  return details;
}

export async function readRanks(client: DbClient, rowIds: readonly string[], splitIds: readonly string[], siteKey: string): Promise<GrindingPlanningBoardProjectionRanks> {
  const rows: RankRow[] = [];
  for (const chunk of chunkLeaderboardRowIdsForHydrate([...new Set(rowIds)])) {
    rows.push(...await client.productionScheduleOrderAssignment.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: chunk }, OR: [{ siteKey }, { location: siteKey }] },
      select: { csvDashboardRowId: true, resourceCd: true, orderNumber: true, updatedAt: true, siteKey: true, location: true }, orderBy: { updatedAt: 'desc' }
    }));
  }
  const splits: SplitRankRow[] = [];
  for (const chunk of chunkLeaderboardRowIdsForHydrate([...new Set(splitIds)])) {
    splits.push(...await client.productionScheduleOrderSplitAssignment.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, splitId: { in: chunk }, OR: [{ siteKey }, { location: siteKey }] },
      select: { splitId: true, resourceCd: true, orderNumber: true, updatedAt: true, siteKey: true, location: true }, orderBy: { updatedAt: 'desc' }
    }));
  }
  const preferred = (candidate: { location: string; updatedAt: Date }, current: { location: string; updatedAt: Date }) => {
    const candidateRank = candidate.location === siteKey ? 0 : 1;
    const currentRank = current.location === siteKey ? 0 : 1;
    return candidateRank !== currentRank ? candidateRank < currentRank : candidate.updatedAt.getTime() > current.updatedAt.getTime();
  };
  const rowMap = new Map<string, RankRow>();
  for (const row of rows) { const current = rowMap.get(row.csvDashboardRowId); if (!current || preferred(row, current)) rowMap.set(row.csvDashboardRowId, row); }
  const splitMap = new Map<string, SplitRankRow>();
  for (const row of splits) { const current = splitMap.get(row.splitId); if (!current || preferred(row, current)) splitMap.set(row.splitId, row); }
  return { rows: rowMap, splits: splitMap };
}

export async function readOverrides(client: DbClient, siteKey: string, itemKeys?: readonly string[]): Promise<Map<string, ProductionScheduleGrindingPlanningBoardOverride>> {
  const rows = await client.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey,
      ...(itemKeys == null ? {} : { itemKey: { in: [...new Set(itemKeys)] } })
    }
  });
  return new Map(rows.map((row) => [row.itemKey, row]));
}

export async function readMasterResourceCds(client: DbClient): Promise<Set<string>> {
  const rows = await client.productionScheduleResourceMaster.findMany({ select: { resourceCd: true } });
  return new Set(rows.map((row) => normalizeProductionScheduleResourceCd(row.resourceCd)).filter(Boolean));
}

export async function readPlanningResourceCandidates(client: DbClient, category: GrindingPlanningBoardCategory, policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>): Promise<string[]> {
  const master = await client.productionScheduleResourceMaster.findMany({ select: { resourceCd: true, resourceGroupCd: true } });
  return Array.from(new Set(master.filter((row) => !isSendaiResourceGroupCd(row.resourceGroupCd)).map((row) => normalizeProductionScheduleResourceCd(row.resourceCd)).filter(Boolean))).filter((value) => isCategoryResource(value, category, policy)).sort((a, b) => a.localeCompare(b));
}
