import {
  SelfInspectionService,
  createSelfInspectionDecorationCache,
  ensureSelfInspectionSessionsInCache,
  ensureSelfInspectionTemplatesForRows,
  type SelfInspectionDecorationCache
} from '../../part-measurement/self-inspection.service.js';
import {
  resolvePartMeasurementProcessGroupForApi,
} from '../policies/resource-category-policy.service.js';
import {
  filterSelfInspectionEligibleProductionScheduleRows,
  hasSelfInspectionCandidateListFilters
} from '../self-inspection-schedule-eligibility.js';
import { prepareProductionScheduleDashboardFilters } from './filters.js';
import { fetchProductionScheduleDashboardRowsRawPage } from './raw-page.js';
import {
  SELF_INSPECTION_SCHEDULE_MAX_SCAN_PAGES,
  SELF_INSPECTION_SCHEDULE_SCAN_CHUNK_SIZE,
  type ProductionScheduleListParams,
  type ProductionScheduleListResult,
  type ProductionScheduleRow,
} from './types.js';

export async function enrichProductionScheduleRowsForSelfInspectionCandidate(
  rows: ProductionScheduleRow[],
  locationKey: string,
  siteKey: string | undefined,
  decorationCache: SelfInspectionDecorationCache
): Promise<ProductionScheduleRow[]> {
  if (rows.length === 0) {
    return rows;
  }

  const rowsWithProcessGroup = rows.map((row) => {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const resourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    return {
      ...row,
      actualPerPieceMinutes: null,
      customerName: null,
      partMeasurementProcessGroup: resourceCd
        ? resolvePartMeasurementProcessGroupForApi(resourceCd, decorationCache.policy)
        : undefined
    };
  });

  const selfInspectionService = new SelfInspectionService();
  const selfInspectionDecorations = await selfInspectionService.buildLeaderboardDecorations(
    rowsWithProcessGroup.map((row) => ({
      id: row.id,
      rowData: row.rowData,
      plannedQuantity: row.plannedQuantity
    })),
    { siteKey },
    decorationCache
  );
  const selfInspectionById = new Map(selfInspectionDecorations.map((row) => [row.id, row]));

  return rowsWithProcessGroup.map((row) => {
    const decoration = selfInspectionById.get(row.id);
    return {
      ...row,
      plannedQuantity: decoration?.resolvedPlannedQuantity ?? row.plannedQuantity ?? null,
      hasSelfInspectionDrawing: decoration?.hasSelfInspectionDrawing ?? false,
      selfInspectionTemplateId: decoration?.selfInspectionTemplateId ?? null,
      selfInspectionStatus: decoration?.selfInspectionStatus ?? null,
      selfInspectionEntryPath: decoration?.selfInspectionEntryPath ?? null
    };
  });
}

/**
 * 自主検査開始可能行のみ返す。生産日程を `fetchProductionScheduleDashboardRowsRawPage` で
 * LIMIT/OFFSET チャンク走査し、各行に自主検査装飾を付与してから eligibility で絞る。
 * `responseProfile=leaderboard` は page/offset を持たないため、ここでは使用しない。
 */
export async function listSelfInspectionEligibleProductionScheduleRows(
  params: Omit<ProductionScheduleListParams, 'responseProfile' | 'selfInspectionEligibleOnly'>
): Promise<ProductionScheduleListResult> {
  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, Math.min(params.pageSize, 200));
  const skip = (page - 1) * pageSize;
  const needThrough = skip + pageSize;

  if (
    !hasSelfInspectionCandidateListFilters({
      queryText: params.queryText,
      resourceCds: params.resourceCds,
      productNos: params.productNos
    })
  ) {
    return {
      page,
      pageSize,
      rows: [],
      hasMore: false
    };
  }

  const filters = await prepareProductionScheduleDashboardFilters(params);
  if (filters.kind === 'blocked_empty_search') {
    return {
      page,
      pageSize,
      rows: [],
      hasMore: false
    };
  }

  const { baseWhere, queryWhere, siteScopedGlobalRankLocation } = filters;
  const decorationCache = await createSelfInspectionDecorationCache({
    siteKey: params.siteKey,
    resourceCds: params.resourceCds
  });
  const eligibleCollected: ProductionScheduleRow[] = [];
  const seenRowIds = new Set<string>();
  let scheduleOffset = 0;
  let scheduleExhausted = false;
  let hitScanCap = false;
  let scanIterations = 0;

  while (eligibleCollected.length < needThrough && scanIterations < SELF_INSPECTION_SCHEDULE_MAX_SCAN_PAGES) {
    scanIterations += 1;
    const rawRows = await fetchProductionScheduleDashboardRowsRawPage({
      baseWhere,
      queryWhere,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation,
      offset: scheduleOffset,
      limit: SELF_INSPECTION_SCHEDULE_SCAN_CHUNK_SIZE
    });
    if (rawRows.length === 0) {
      scheduleExhausted = true;
      break;
    }

    await ensureSelfInspectionTemplatesForRows(decorationCache, rawRows);
    await ensureSelfInspectionSessionsInCache(
      decorationCache,
      rawRows.map((row) => row.id)
    );
    const enrichedRows = await enrichProductionScheduleRowsForSelfInspectionCandidate(
      rawRows,
      params.locationKey,
      params.siteKey,
      decorationCache
    );
    for (const row of filterSelfInspectionEligibleProductionScheduleRows(enrichedRows)) {
      if (seenRowIds.has(row.id)) {
        continue;
      }
      seenRowIds.add(row.id);
      eligibleCollected.push(row);
    }

    scheduleOffset += rawRows.length;
    if (rawRows.length < SELF_INSPECTION_SCHEDULE_SCAN_CHUNK_SIZE) {
      scheduleExhausted = true;
      break;
    }
    if (scanIterations >= SELF_INSPECTION_SCHEDULE_MAX_SCAN_PAGES) {
      hitScanCap = true;
      break;
    }
  }

  const pageRows = eligibleCollected.slice(skip, skip + pageSize);
  const hasMore = eligibleCollected.length > needThrough || !scheduleExhausted || hitScanCap;

  return {
    page,
    pageSize,
    rows: pageRows,
    hasMore
  };
}

export function toSelfInspectionEligibleListParams(
  params: ProductionScheduleListParams
): Parameters<typeof listSelfInspectionEligibleProductionScheduleRows>[0] {
  const rest = { ...params };
  delete rest.selfInspectionEligibleOnly;
  delete rest.responseProfile;
  return rest;
}
