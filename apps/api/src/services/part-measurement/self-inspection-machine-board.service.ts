import {
  normalizeMachineNameForCompare,
  scanProductionScheduleRowsForSignageMachineBoard,
  type SignageMachineBoardScheduleRow,
} from '../production-schedule/production-schedule-query.service.js';
import { getResourceNameMapByResourceCds } from '../production-schedule/resource-master.service.js';
import { resolveSignageLeaderOrderQueryKeys } from '../signage/leader-order-cards/resolve-signage-leader-order-location.js';
import {
  aggregateSelfInspectionMachineBoardCards,
  type SelfInspectionMachineBoardAggregationRow,
} from './self-inspection-machine-board-aggregation.js';
import {
  fetchSelfInspectionMachineBoardOutcomeRecordsByScheduleRowIds,
  type SelfInspectionMachineBoardOutcomeRecord,
} from './self-inspection-machine-board.repository.js';
import { resolveSelfInspectionMachineBoardResourceDisplayName } from './self-inspection-machine-board-resource-name.js';
import type { SelfInspectionMachineBoardOutcomeInput } from './self-inspection-machine-board-outcome.js';
import type { SelfInspectionMachineBoardViewModel } from './self-inspection-machine-board.types.js';
import {
  createSelfInspectionDecorationCache,
  ensureSelfInspectionSessionsInCache,
  ensureSelfInspectionTemplatesForRows,
  SelfInspectionService,
} from './self-inspection.service.js';
import {
  buildFlatMachineBoardPages,
  sanitizeSelfInspectionMachineBoardPartsPerPage,
} from '../signage/self-inspection-machine-board/pagination.js';
import {
  MAX_SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_ROWS,
  SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_FETCH_PAGE_SIZE,
} from '../signage/self-inspection-machine-board/layout-contracts.js';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function rowDataField(rowData: unknown, key: string): string {
  const data = (rowData ?? {}) as Record<string, unknown>;
  return normalizeText(String(data[key] ?? ''));
}

type LeaderboardSelfInspectionDecoration = {
  id: string;
  hasSelfInspectionDrawing: boolean;
  selfInspectionStatus: string | null;
  completedEntryCount?: number | null;
  resolvedRequiredEntryCount?: number | null;
  resolvedPlannedQuantity?: number | null;
  pendingReviewCount?: number | null;
};

function finiteNonNegative(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value as number));
}

function rowOutcomeInput(
  decoration: LeaderboardSelfInspectionDecoration,
  requiredEntryCount: number,
  completedEntryCount: number
): SelfInspectionMachineBoardOutcomeInput {
  return {
    confirmedEntryCount: completedEntryCount,
    completedEntryCount,
    requiredEntryCount,
    pendingReviewCount: decoration.pendingReviewCount,
    legacyStatus: decoration.selfInspectionStatus,
  };
}

type MachineBoardSortableCard = {
  dueDate: Date | null;
  fseiban: string;
  productNo: string;
  normalizedMachineName?: string | null;
  machineName?: string | null;
  fhincd: string;
};

function compareMachineBoardCards(
  a: MachineBoardSortableCard,
  b: MachineBoardSortableCard
): number {
  const aHasDueDate = a.dueDate != null;
  const bHasDueDate = b.dueDate != null;
  if (aHasDueDate !== bHasDueDate) {
    return aHasDueDate ? -1 : 1;
  }
  const aTime = a.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  if (a.fseiban !== b.fseiban) {
    return a.fseiban.localeCompare(b.fseiban);
  }
  if (a.productNo !== b.productNo) {
    return a.productNo.localeCompare(b.productNo);
  }
  const aMachineName =
    normalizeText(a.normalizedMachineName) || normalizeMachineNameForCompare(a.machineName);
  const bMachineName =
    normalizeText(b.normalizedMachineName) || normalizeMachineNameForCompare(b.machineName);
  if (aMachineName !== bMachineName) {
    return aMachineName.localeCompare(bMachineName);
  }
  return a.fhincd.localeCompare(b.fhincd);
}

function buildEligibleRowsFromScheduleRows(
  machineName: string,
  normalizedMachineName: string,
  rows: SignageMachineBoardScheduleRow[],
  decorations: LeaderboardSelfInspectionDecoration[]
): SelfInspectionMachineBoardAggregationRow[] {
  const decorationByRowId = new Map(decorations.map((item) => [item.id, item]));
  const eligibleRows: SelfInspectionMachineBoardAggregationRow[] = [];

  for (const row of rows) {
    const decoration = decorationByRowId.get(row.id);
    if (!decoration?.hasSelfInspectionDrawing) {
      continue;
    }

    const fseiban = rowDataField(row.rowData, 'FSEIBAN');
    const productNo = rowDataField(row.rowData, 'ProductNo');
    const fhincd = rowDataField(row.rowData, 'FHINCD');
    const fhinmei = rowDataField(row.rowData, 'FHINMEI');
    // 旧日程 fixture / 既存データには資源CDが無い行もある。カード自体は
    // 失わず、表示上の未設定資源へ集約する（実資源CDは通常ここへ入る）。
    const resourceCd = rowDataField(row.rowData, 'FSIGENCD') || '__UNSPECIFIED__';
    if (!fseiban || !productNo || !fhincd) {
      continue;
    }

    const completedEntryCount = finiteNonNegative(decoration.completedEntryCount, 0);
    const requiredEntryCount = Math.max(
      1,
      finiteNonNegative(
        decoration.resolvedRequiredEntryCount ?? decoration.resolvedPlannedQuantity,
        1
      )
    );
    eligibleRows.push({
      scheduleRowId: row.id,
      fseiban,
      productNo,
      fhincd,
      fhinmei: fhinmei || fhincd,
      machineName,
      normalizedMachineName,
      resourceCd,
      dueDate: row.dueDate,
      isScheduled: row.dueDate != null,
      confirmedEntryCount: completedEntryCount,
      completedEntryCount,
      requiredEntryCount,
      outcome: rowOutcomeInput(decoration, requiredEntryCount, completedEntryCount),
    });
  }

  return eligibleRows;
}

function mergeRepositoryOutcomes(
  rows: SelfInspectionMachineBoardAggregationRow[],
  outcomes: Map<string, SelfInspectionMachineBoardOutcomeRecord>
): SelfInspectionMachineBoardAggregationRow[] {
  return rows.map((row) => {
    const outcome = outcomes.get(row.scheduleRowId);
    if (!outcome) {
      return row;
    }
    const requiredEntryCount = row.requiredEntryCount;
    const confirmedEntryCount = finiteNonNegative(
      outcome.confirmedEntryCount ?? outcome.completedEntryCount,
      row.confirmedEntryCount ?? row.completedEntryCount ?? 0
    );
    return {
      ...row,
      confirmedEntryCount,
      completedEntryCount: confirmedEntryCount,
      requiredEntryCount,
      ...(outcome.updatedAt ? { updatedAt: outcome.updatedAt } : {}),
      outcome: {
        ...outcome,
        confirmedEntryCount,
        completedEntryCount: confirmedEntryCount,
        requiredEntryCount,
      },
    };
  });
}

/**
 * 自主検査機種別ボード VM のオーケストレーター。
 * scan/DB decoration/repository 判定列取得と、DB 非依存のカード集約を接続する。
 */
export async function buildSelfInspectionMachineBoardViewModel(options: {
  machineName: string;
  deviceScopeKey?: string;
  partsPerPage?: number;
  /** 旧 detailTopN 設定は受け付けるが、新 VM では詳細ページを生成しない。 */
  detailTopN?: number;
}): Promise<SelfInspectionMachineBoardViewModel> {
  const machineName = normalizeText(options.machineName);
  const normalizedMachineName = normalizeMachineNameForCompare(machineName);
  const partsPerPage = sanitizeSelfInspectionMachineBoardPartsPerPage(
    options.partsPerPage ?? Number.NaN
  );
  const updatedAt = new Date();

  if (normalizedMachineName.length === 0) {
    return {
      machineName,
      normalizedMachineName,
      updatedAt,
      pages: [],
      totalPages: 0,
      scheduleRowCap: MAX_SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_ROWS,
      scheduleRowHasMore: false,
      loadedScheduleRowCount: 0,
    };
  }

  const scopeKey = normalizeText(options.deviceScopeKey);
  const { locationKey, siteKey } = scopeKey
    ? await resolveSignageLeaderOrderQueryKeys(scopeKey)
    : { locationKey: 'signage-self-inspection-machine-board', siteKey: undefined };

  const selfInspectionService = new SelfInspectionService();
  const decorationCache = await createSelfInspectionDecorationCache({ siteKey });
  const eligibleRows: SelfInspectionMachineBoardAggregationRow[] = [];
  let scannedAnyRows = false;

  const scanMeta = await scanProductionScheduleRowsForSignageMachineBoard(
    {
      machineName,
      locationKey,
      siteKey,
      maxRows: MAX_SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_ROWS,
      pageSize: SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_FETCH_PAGE_SIZE,
    },
    async (pageRows) => {
      if (pageRows.length === 0) {
        return;
      }
      scannedAnyRows = true;
      await ensureSelfInspectionTemplatesForRows(decorationCache, pageRows);
      await ensureSelfInspectionSessionsInCache(
        decorationCache,
        pageRows.map((row) => row.id)
      );
      const decorations = await selfInspectionService.buildLeaderboardDecorations(
        pageRows.map((row) => ({
          id: row.id,
          rowData: row.rowData,
          plannedQuantity: row.plannedQuantity,
        })),
        { siteKey },
        decorationCache
      );
      eligibleRows.push(
        ...buildEligibleRowsFromScheduleRows(
          machineName,
          normalizedMachineName,
          pageRows,
          decorations
        )
      );
    }
  );

  if (!scannedAnyRows) {
    return {
      machineName,
      normalizedMachineName,
      updatedAt,
      pages: [],
      totalPages: 0,
      scheduleRowCap: MAX_SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_ROWS,
      scheduleRowHasMore: !scanMeta.scheduleExhausted || scanMeta.hitScanCap,
      loadedScheduleRowCount: 0,
    };
  }

  eligibleRows.sort(compareMachineBoardCards);
  const displayCap = MAX_SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_ROWS;
  const displayRows = eligibleRows.slice(0, displayCap);
  const scheduleRowHasMore =
    eligibleRows.length > displayCap || !scanMeta.scheduleExhausted || scanMeta.hitScanCap;

  const outcomeRecords = await fetchSelfInspectionMachineBoardOutcomeRecordsByScheduleRowIds(
    displayRows.map((row) => row.scheduleRowId)
  );
  const displayRowsWithOutcomes = mergeRepositoryOutcomes(displayRows, outcomeRecords);
  const resourceNameMap = await getResourceNameMapByResourceCds(
    displayRowsWithOutcomes.map((row) => row.resourceCd)
  );
  const displayRowsWithResourceNames = displayRowsWithOutcomes.map((row) => ({
    ...row,
    resourceDisplayName: resolveSelfInspectionMachineBoardResourceDisplayName(
      row.resourceCd,
      resourceNameMap
    ),
  }));
  const cards = aggregateSelfInspectionMachineBoardCards(displayRowsWithResourceNames);
  cards.sort(compareMachineBoardCards);

  const pages = buildFlatMachineBoardPages({
    machineName,
    updatedAt,
    orderedParts: cards,
    detailPages: [],
    partsPerPage,
    scheduleRowCap: displayCap,
    scheduleRowHasMore,
  });

  return {
    machineName,
    normalizedMachineName,
    updatedAt,
    pages,
    totalPages: pages.length,
    scheduleRowCap: displayCap,
    scheduleRowHasMore,
    loadedScheduleRowCount: displayRows.length,
  };
}
