import type { Prisma } from '@prisma/client';

import {
  normalizeMachineNameForCompare,
  scanProductionScheduleRowsForSignageMachineBoard,
  type SignageMachineBoardScheduleRow,
} from '../production-schedule/production-schedule-query.service.js';
import { resolveSignageLeaderOrderQueryKeys } from '../signage/leader-order-cards/resolve-signage-leader-order-location.js';
import { resolveHeatstripCellTone } from './self-inspection-machine-board-heatstrip.js';
import {
  fetchSelfInspectionSessionDetailsByScheduleRowIds,
  type SelfInspectionMachineBoardSessionDetail,
} from './self-inspection-machine-board.repository.js';
import type {
  HeatstripMeasurementPoint,
  SelfInspectionMachineBoardDetailPage,
  SelfInspectionMachineBoardPartItem,
  SelfInspectionMachineBoardPartStatus,
  SelfInspectionMachineBoardViewModel,
} from './self-inspection-machine-board.types.js';
import {
  createSelfInspectionDecorationCache,
  ensureSelfInspectionSessionsInCache,
  ensureSelfInspectionTemplatesForRows,
  SelfInspectionService,
} from './self-inspection.service.js';
import {
  buildFlatMachineBoardPages,
  sanitizeSelfInspectionMachineBoardDetailTopN,
  sanitizeSelfInspectionMachineBoardPartsPerPage,
} from '../signage/self-inspection-machine-board/pagination.js';
import {
  MAX_DETAIL_MEASUREMENT_POINTS,
  MAX_SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_ROWS,
  SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_FETCH_PAGE_SIZE,
} from '../signage/self-inspection-machine-board/layout-contracts.js';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function rowDataField(rowData: Prisma.JsonValue, key: string): string {
  const data = (rowData ?? {}) as Record<string, unknown>;
  return normalizeText(String(data[key] ?? ''));
}

function resolvePartStatus(
  decorationStatus: 'not_started' | 'in_progress' | 'completed' | null,
  hasDrawing: boolean
): SelfInspectionMachineBoardPartStatus | null {
  if (!hasDrawing) {
    return null;
  }
  return decorationStatus ?? 'not_started';
}

function statusSortWeight(status: SelfInspectionMachineBoardPartStatus): number {
  switch (status) {
    case 'in_progress':
      return 0;
    case 'not_started':
      return 1;
    case 'completed':
      return 2;
    default:
      return 3;
  }
}

function comparePartsForDisplay(a: SelfInspectionMachineBoardPartItem, b: SelfInspectionMachineBoardPartItem): number {
  const statusDiff = statusSortWeight(a.status) - statusSortWeight(b.status);
  if (statusDiff !== 0) {
    return statusDiff;
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
  return a.fhincd.localeCompare(b.fhincd);
}

function entrySlotLabel(kind: string, entryIndex: number): string {
  switch (kind) {
    case 'FIRST':
      return '最初';
    case 'LAST':
      return '最後';
    case 'SINGLE':
      return '1件';
    default:
      return `#${entryIndex + 1}`;
  }
}

function buildProgressLabel(completed: number, required: number): string {
  return `${completed}/${required}`;
}

type LeaderboardSelfInspectionDecoration = {
  id: string;
  hasSelfInspectionDrawing: boolean;
  selfInspectionStatus: 'not_started' | 'in_progress' | 'completed' | null;
  completedEntryCount?: number | null;
  resolvedRequiredEntryCount?: number | null;
  resolvedPlannedQuantity?: number | null;
};

function buildEligiblePartsFromScheduleRows(
  rows: SignageMachineBoardScheduleRow[],
  decorations: LeaderboardSelfInspectionDecoration[]
): SelfInspectionMachineBoardPartItem[] {
  const decorationByRowId = new Map(decorations.map((item) => [item.id, item]));
  const parts: SelfInspectionMachineBoardPartItem[] = [];

  for (const row of rows) {
    const decoration = decorationByRowId.get(row.id);
    if (!decoration?.hasSelfInspectionDrawing) {
      continue;
    }

    const status = resolvePartStatus(decoration.selfInspectionStatus, decoration.hasSelfInspectionDrawing);
    if (!status) {
      continue;
    }

    const fseiban = rowDataField(row.rowData, 'FSEIBAN');
    const productNo = rowDataField(row.rowData, 'ProductNo');
    const fhincd = rowDataField(row.rowData, 'FHINCD');
    const fhinmei = rowDataField(row.rowData, 'FHINMEI');
    if (!fseiban || !productNo || !fhincd) {
      continue;
    }

    const completedEntryCount = decoration.completedEntryCount ?? 0;
    const requiredEntryCount =
      decoration.resolvedRequiredEntryCount ??
      decoration.resolvedPlannedQuantity ??
      1;

    parts.push({
      scheduleRowId: row.id,
      fseiban,
      productNo,
      fhincd,
      fhinmei: fhinmei || fhincd,
      status,
      completedEntryCount,
      requiredEntryCount,
      progressLabel: buildProgressLabel(completedEntryCount, requiredEntryCount),
      dueDate: row.dueDate,
      isScheduled: row.dueDate != null,
    });
  }

  return parts;
}

function buildDetailPageFromSession(args: {
  machineName: string;
  updatedAt: Date;
  part: SelfInspectionMachineBoardPartItem;
  session: SelfInspectionMachineBoardSessionDetail;
}): SelfInspectionMachineBoardDetailPage | null {
  const { session, part } = args;
  if (session.entries.length === 0 || session.template.items.length === 0) {
    return null;
  }

  const hiddenEntryCount = Math.max(0, session.totalEntryCount - session.entries.length);
  const hiddenPointCount = Math.max(0, session.totalTemplateItemCount - session.template.items.length);
  const maxItemRows =
    hiddenPointCount > 0 ? MAX_DETAIL_MEASUREMENT_POINTS - 1 : MAX_DETAIL_MEASUREMENT_POINTS;
  const visibleItems = session.template.items.slice(0, maxItemRows);
  const truncatedPointCount = Math.max(0, session.totalTemplateItemCount - visibleItems.length);

  const measurementPoints: HeatstripMeasurementPoint[] = visibleItems.map((item) => ({
    templateItemId: item.id,
    label: item.measurementLabel,
    cells: [
      ...session.entries.map((entry) => {
        const rawValue = entry.values.find((value) => value.templateItemId === item.id)?.value ?? null;
        const resolved = resolveHeatstripCellTone(rawValue, item);
        return {
          entryIndex: entry.entryIndex,
          entryLabel: entrySlotLabel(entry.entrySlotKind, entry.entryIndex),
          tone: resolved.tone,
          displayValue: resolved.displayValue,
        };
      }),
      ...(hiddenEntryCount > 0
        ? [
            {
              entryIndex: -1,
              entryLabel: `+${hiddenEntryCount}`,
              tone: 'neutral' as const,
              displayValue: null,
            },
          ]
        : []),
    ],
  }));

  if (truncatedPointCount > 0) {
    measurementPoints.push({
      templateItemId: '__truncated__',
      label: `他 ${truncatedPointCount} 測定点`,
      cells: session.entries.map((entry) => ({
        entryIndex: entry.entryIndex,
        entryLabel: entrySlotLabel(entry.entrySlotKind, entry.entryIndex),
        tone: 'neutral' as const,
        displayValue: null,
      })),
    });
  }

  return {
    kind: 'detail',
    machineName: args.machineName,
    updatedAt: args.updatedAt,
    fseiban: part.fseiban,
    fhincd: part.fhincd,
    fhinmei: part.fhinmei,
    status: part.status,
    progressLabel: part.progressLabel,
    measurementPoints,
    pageIndex: 0,
    pageCount: 0,
  };
}

export async function buildSelfInspectionMachineBoardViewModel(options: {
  machineName: string;
  deviceScopeKey?: string;
  partsPerPage?: number;
  detailTopN?: number;
}): Promise<SelfInspectionMachineBoardViewModel> {
  const machineName = normalizeText(options.machineName);
  const normalizedMachineName = normalizeMachineNameForCompare(machineName);
  const partsPerPage = sanitizeSelfInspectionMachineBoardPartsPerPage(
    options.partsPerPage ?? Number.NaN
  );
  const detailTopN = sanitizeSelfInspectionMachineBoardDetailTopN(options.detailTopN ?? Number.NaN);
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
  const parts: SelfInspectionMachineBoardPartItem[] = [];
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
      parts.push(...buildEligiblePartsFromScheduleRows(pageRows, decorations));
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

  parts.sort(comparePartsForDisplay);

  const displayCap = MAX_SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_ROWS;
  const totalEligibleParts = parts.length;
  const displayParts = parts.slice(0, displayCap);
  const scheduleRowHasMore =
    totalEligibleParts > displayCap ||
    !scanMeta.scheduleExhausted ||
    scanMeta.hitScanCap;

  const detailCandidateIds = displayParts
    .filter((part) => part.completedEntryCount > 0)
    .slice(0, detailTopN)
    .map((part) => part.scheduleRowId);

  const sessionDetails = await fetchSelfInspectionSessionDetailsByScheduleRowIds(detailCandidateIds);

  const detailPages: SelfInspectionMachineBoardDetailPage[] = [];
  for (const scheduleRowId of detailCandidateIds) {
    const part = displayParts.find((item) => item.scheduleRowId === scheduleRowId);
    const session = sessionDetails.get(scheduleRowId);
    if (!part || !session) {
      continue;
    }
    const page = buildDetailPageFromSession({
      machineName,
      updatedAt,
      part,
      session,
    });
    if (page) {
      detailPages.push(page);
    }
  }

  const pages = buildFlatMachineBoardPages({
    machineName,
    updatedAt,
    orderedParts: displayParts,
    detailPages,
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
    loadedScheduleRowCount: displayParts.length,
  };
}
