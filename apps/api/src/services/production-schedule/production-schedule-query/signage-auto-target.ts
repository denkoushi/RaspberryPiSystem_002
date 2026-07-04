import {
  ensureSelfInspectionSessionsInCache,
  ensureSelfInspectionTemplatesForRows,
  type SelfInspectionDecorationCache
} from '../../part-measurement/self-inspection.service.js';
import { enrichProductionScheduleRowsWithResolvedMachineName } from '../production-schedule-machine-name-enrichment.service.js';
import { prepareProductionScheduleDashboardFilters } from './filters.js';
import { fetchProductionScheduleDashboardRowsRawPage } from './raw-page.js';
import { enrichProductionScheduleRowsForSelfInspectionCandidate } from './self-inspection-eligible.js';
import type { ProductionScheduleRow, ProductionScheduleSelfInspectionStatus } from './types.js';

/** サイネージ自主検査 auto 候補選定向けの装飾入力行（full 一覧の実績時間・顧客名は省略） */
export type SignageAutoTargetSelectorScheduleRow = Pick<
  ProductionScheduleRow,
  | 'id'
  | 'seibanJoinKey'
  | 'occurredAt'
  | 'rowData'
  | 'dueDate'
  | 'plannedQuantity'
  | 'processingOrder'
  | 'globalRank'
  | 'note'
  | 'processingType'
  | 'plannedStartDate'
  | 'plannedEndDate'
>;

function mapSignageAutoTargetSelectorScheduleRows(
  rows: ProductionScheduleRow[]
): SignageAutoTargetSelectorScheduleRow[] {
  return rows.map((row) => ({
    id: row.id,
    seibanJoinKey: row.seibanJoinKey,
    occurredAt: row.occurredAt,
    rowData: row.rowData,
    dueDate: row.dueDate,
    plannedQuantity: row.plannedQuantity,
    processingOrder: row.processingOrder,
    globalRank: row.globalRank,
    note: row.note,
    processingType: row.processingType,
    plannedStartDate: row.plannedStartDate,
    plannedEndDate: row.plannedEndDate,
  }));
}

export type SignageAutoTargetSelectorScanMeta = {
  scheduleExhausted: boolean;
  /** 走査上限到達後の 1 件プローブで後続行が存在する */
  hitScanCap: boolean;
  scannedRowCount: number;
  maxRows: number;
};

export type SelfInspectionMachineTargetSelectorRowDecoration = {
  id: string;
  resolvedMachineName: string | null;
  hasSelfInspectionDrawing: boolean;
  selfInspectionStatus: ProductionScheduleSelfInspectionStatus | null;
};

/**
 * サイネージ自主検査 auto 候補選定向け: resourceCds フィルタで raw page 走査。
 * full 一覧（実績時間・顧客名）を避け、上限到達時は 1 件プローブで hitScanCap を確定する。
 */
export async function scanProductionScheduleRowsForSignageAutoTargetSelector(
  params: {
    resourceCds: string[];
    locationKey: string;
    siteKey?: string;
    maxRows: number;
    pageSize?: number;
  },
  onPage: (rows: SignageAutoTargetSelectorScheduleRow[]) => Promise<void> | void
): Promise<SignageAutoTargetSelectorScanMeta> {
  const scanCap = Math.max(1, Math.min(Math.floor(params.maxRows), 2000));
  const safePageSize = Math.max(1, Math.min(Math.floor(params.pageSize ?? 500), 2000));
  const filters = await prepareProductionScheduleDashboardFilters({
    queryText: '',
    productNos: [],
    resourceCds: params.resourceCds,
    assignedOnlyCds: [],
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: params.locationKey,
    siteKey: params.siteKey,
  });
  if (filters.kind === 'blocked_empty_search') {
    return {
      scheduleExhausted: true,
      hitScanCap: false,
      scannedRowCount: 0,
      maxRows: scanCap,
    };
  }

  const { baseWhere, queryWhere, siteScopedGlobalRankLocation } = filters;
  let offset = 0;
  let scannedRowCount = 0;
  let scheduleExhausted = false;
  let lastPageWasFull = false;

  while (scannedRowCount < scanCap) {
    const remaining = scanCap - scannedRowCount;
    const limit = Math.min(safePageSize, remaining);
    const pageRows = await fetchProductionScheduleDashboardRowsRawPage({
      baseWhere,
      queryWhere,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation,
      offset,
      limit,
    });
    if (pageRows.length === 0) {
      scheduleExhausted = true;
      lastPageWasFull = false;
      break;
    }

    await onPage(mapSignageAutoTargetSelectorScheduleRows(pageRows));
    scannedRowCount += pageRows.length;
    offset += pageRows.length;
    lastPageWasFull = pageRows.length === limit;

    if (pageRows.length < limit) {
      scheduleExhausted = true;
      break;
    }
    if (scannedRowCount >= scanCap) {
      break;
    }
  }

  let hitScanCap = false;
  if (!scheduleExhausted && scannedRowCount >= scanCap && lastPageWasFull) {
    const probeRows = await fetchProductionScheduleDashboardRowsRawPage({
      baseWhere,
      queryWhere,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation,
      offset,
      limit: 1,
    });
    if (probeRows.length > 0) {
      hitScanCap = true;
    } else {
      scheduleExhausted = true;
    }
  }

  return {
    scheduleExhausted,
    hitScanCap,
    scannedRowCount,
    maxRows: scanCap,
  };
}

/** auto 候補選定に必要な rowDecorations のみ（顧客名・フッタチップ・実績時間を省略） */
export async function decorateRowsForSelfInspectionMachineTargetSelector(params: {
  rows: SignageAutoTargetSelectorScheduleRow[];
  locationKey: string;
  siteKey?: string;
  decorationCache: SelfInspectionDecorationCache;
}): Promise<SelfInspectionMachineTargetSelectorRowDecoration[]> {
  if (params.rows.length === 0) {
    return [];
  }

  const productionRows: ProductionScheduleRow[] = params.rows.map((row) => ({
    ...row,
    actualPerPieceMinutes: null,
    customerName: null,
  }));

  await ensureSelfInspectionTemplatesForRows(params.decorationCache, productionRows);
  await ensureSelfInspectionSessionsInCache(
    params.decorationCache,
    productionRows.map((row) => row.id)
  );
  const withSelfInspection = await enrichProductionScheduleRowsForSelfInspectionCandidate(
    productionRows,
    params.locationKey,
    params.siteKey,
    params.decorationCache
  );
  const withMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(
    withSelfInspection.map((row) => ({
      ...row,
      actualPerPieceMinutes: null,
      customerName: null,
    }))
  );

  return withMachineName.map((row) => ({
    id: row.id,
    resolvedMachineName: row.resolvedMachineName ?? null,
    hasSelfInspectionDrawing: row.hasSelfInspectionDrawing ?? false,
    selfInspectionStatus: row.selfInspectionStatus ?? null,
  }));
}
