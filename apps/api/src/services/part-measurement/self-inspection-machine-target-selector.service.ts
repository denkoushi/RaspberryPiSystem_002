import {
  createSelfInspectionDecorationCache,
  type SelfInspectionDecorationCache,
} from './self-inspection.service.js';
import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../production-schedule/constants.js';
import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import {
  decorateRowsForSelfInspectionMachineTargetSelector,
  scanProductionScheduleRowsForSignageAutoTargetSelector,
  type SignageAutoTargetSelectorScheduleRow,
} from '../production-schedule/production-schedule-query.service.js';
import {
  filterLeaderBoardRowsIncompleteForSignage,
  normalizeConfiguredResourceCds,
  normalizeLeaderBoardRowsForSignage,
} from '../signage/leader-order-cards/leader-board-pure.js';
import { resolveSignageLeaderOrderQueryKeys } from '../signage/leader-order-cards/resolve-signage-leader-order-location.js';
import {
  MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
  SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_FETCH_PAGE_SIZE,
} from '../signage/self-inspection-machine-board/layout-contracts.js';
import { sanitizeSelfInspectionMachineBoardMaxAutoMachines } from './self-inspection-machine-board-config.js';
import type {
  SelfInspectionMachineTargetCandidate,
  SelfInspectionMachineTargetSelectionResult,
} from './self-inspection-machine-target-selector.types.js';
function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function isSelectableMachineName(machineName: string): boolean {
  return machineName.length > 0 && machineName !== SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL;
}

function parseDisplayDueToDate(displayDue: string | null | undefined): Date | null {
  if (!displayDue?.trim()) {
    return null;
  }
  const parsed = new Date(displayDue);
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : parsed;
}

type MachineAccumulator = {
  machineName: string;
  normalizedMachineName: string;
  inProgressCount: number;
  earliestDueDate: Date | null;
  sourceRowCount: number;
};

function compareMachineTargets(
  a: SelfInspectionMachineTargetCandidate,
  b: SelfInspectionMachineTargetCandidate
): number {
  if (a.inProgressCount !== b.inProgressCount) {
    return b.inProgressCount - a.inProgressCount;
  }
  const aTime = a.earliestDueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const bTime = b.earliestDueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  return a.machineName.localeCompare(b.machineName);
}

function upsertMachineAccumulator(
  map: Map<string, MachineAccumulator>,
  args: {
    machineName: string;
    dueDate: Date | null;
    isInProgress: boolean;
  }
): void {
  const normalizedMachineName = normalizeMachineNameForCompare(args.machineName);
  if (normalizedMachineName.length === 0) {
    return;
  }

  const existing = map.get(normalizedMachineName);
  if (!existing) {
    map.set(normalizedMachineName, {
      machineName: args.machineName.trim(),
      normalizedMachineName,
      inProgressCount: args.isInProgress ? 1 : 0,
      earliestDueDate: args.isInProgress ? args.dueDate : null,
      sourceRowCount: 1,
    });
    return;
  }

  existing.sourceRowCount += 1;
  if (args.isInProgress) {
    existing.inProgressCount += 1;
    if (args.dueDate) {
      if (!existing.earliestDueDate || args.dueDate.getTime() < existing.earliestDueDate.getTime()) {
        existing.earliestDueDate = args.dueDate;
      }
    }
  }
}

function toSignageScheduleRowInput(row: SignageAutoTargetSelectorScheduleRow) {
  return {
    id: row.id,
    rowData: row.rowData,
    processingOrder: row.processingOrder,
    note: row.note,
    dueDate: row.dueDate,
    plannedQuantity: row.plannedQuantity,
    plannedEndDate: row.plannedEndDate,
  };
}

async function accumulateMachineTargetsFromPageRows(
  machineMap: Map<string, MachineAccumulator>,
  pageRows: SignageAutoTargetSelectorScheduleRow[],
  locationKey: string,
  siteKey: string | undefined,
  decorationCache: SelfInspectionDecorationCache
): Promise<void> {
  const normalized = normalizeLeaderBoardRowsForSignage(pageRows.map(toSignageScheduleRowInput));
  const incompleteRows = filterLeaderBoardRowsIncompleteForSignage(normalized);
  if (incompleteRows.length === 0) {
    return;
  }

  const incompleteIds = new Set(incompleteRows.map((row) => row.id));
  const displayDueById = new Map(incompleteRows.map((row) => [row.id, row.displayDue]));
  const targetRows = pageRows.filter((row) => incompleteIds.has(row.id));
  const rowDecorations = await decorateRowsForSelfInspectionMachineTargetSelector({
    rows: targetRows,
    locationKey,
    siteKey,
    decorationCache,
  });

  for (const decoration of rowDecorations) {
    if (!decoration.hasSelfInspectionDrawing) {
      continue;
    }
    const machineName = normalizeText(decoration.resolvedMachineName);
    if (!isSelectableMachineName(machineName)) {
      continue;
    }
    upsertMachineAccumulator(machineMap, {
      machineName,
      dueDate: parseDisplayDueToDate(displayDueById.get(decoration.id)),
      isInProgress: decoration.selfInspectionStatus === 'in_progress',
    });
  }
}

/**
 * deviceScopeKey + resourceCds で定まる順位ボード相当の母集団から、
 * 黄（in_progress）を持つ機種だけを抽出する。
 */
export async function selectSelfInspectionMachineTargets(options: {
  deviceScopeKey: string;
  resourceCds: string[];
  maxAutoMachines?: number;
}): Promise<SelfInspectionMachineTargetSelectionResult> {
  const scopeKey = normalizeText(options.deviceScopeKey);
  const orderedResourceCds = normalizeConfiguredResourceCds(options.resourceCds);
  const maxAutoMachines = sanitizeSelfInspectionMachineBoardMaxAutoMachines(options.maxAutoMachines);

  if (!scopeKey || orderedResourceCds.length === 0) {
    return {
      targets: [],
      totalCandidateCount: 0,
      truncated: false,
      hitScanCap: false,
      scannedRowCount: 0,
    };
  }

  const { locationKey, siteKey } = await resolveSignageLeaderOrderQueryKeys(scopeKey);
  const machineMap = new Map<string, MachineAccumulator>();
  const decorationCache = await createSelfInspectionDecorationCache({
    siteKey,
    resourceCds: orderedResourceCds,
  });

  const scanMeta = await scanProductionScheduleRowsForSignageAutoTargetSelector(
    {
      resourceCds: orderedResourceCds,
      locationKey,
      siteKey,
      maxRows: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
      pageSize: SELF_INSPECTION_MACHINE_BOARD_SCHEDULE_FETCH_PAGE_SIZE,
    },
    async (pageRows) => {
      await accumulateMachineTargetsFromPageRows(
        machineMap,
        pageRows,
        locationKey,
        siteKey,
        decorationCache
      );
    }
  );

  const allCandidates = [...machineMap.values()]
    .filter((item) => item.inProgressCount > 0)
    .map((item) => ({
      machineName: item.machineName,
      normalizedMachineName: item.normalizedMachineName,
      inProgressCount: item.inProgressCount,
      earliestDueDate: item.earliestDueDate,
      sourceRowCount: item.sourceRowCount,
    }))
    .sort(compareMachineTargets);

  const truncated = allCandidates.length > maxAutoMachines;
  const targets = allCandidates.slice(0, maxAutoMachines);

  return {
    targets,
    totalCandidateCount: allCandidates.length,
    truncated,
    hitScanCap: scanMeta.hitScanCap,
    scannedRowCount: scanMeta.scannedRowCount,
  };
}
