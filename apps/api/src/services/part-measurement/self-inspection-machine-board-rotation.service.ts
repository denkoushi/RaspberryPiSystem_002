import { logger } from '../../lib/logger.js';
import {
  MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
  SELF_INSPECTION_MACHINE_BOARD_AUTO_BUILD_CONCURRENCY,
  SELF_INSPECTION_MACHINE_BOARD_AUTO_ROTATION_VM_CACHE_TTL_MS,
} from '../signage/self-inspection-machine-board/layout-contracts.js';
import {
  clearAutoRotationVmCache,
  getAutoRotationVmCache,
  setAutoRotationVmCache,
} from './self-inspection-machine-board-auto-rotation.cache.js';
import { buildSelfInspectionMachineBoardViewModel } from './self-inspection-machine-board.service.js';
import type { SelfInspectionMachineBoardPage } from './self-inspection-machine-board.types.js';
import { selectSelfInspectionMachineTargets } from './self-inspection-machine-target-selector.service.js';
import type { SelfInspectionMachineTargetSelectionResult } from './self-inspection-machine-target-selector.types.js';

export function clearAutoSelfInspectionMachineBoardRotationViewModelCache(): void {
  clearAutoRotationVmCache();
}

export function clearAutoSelfInspectionMachineBoardRotationViewModelCacheForTests(): void {
  clearAutoSelfInspectionMachineBoardRotationViewModelCache();
}

function buildAutoRotationVmCacheKey(options: {
  deviceScopeKey: string;
  resourceCds: string[];
  maxAutoMachines?: number;
  partsPerPage?: number;
  detailTopN?: number;
}): string {
  return [
    options.deviceScopeKey,
    options.resourceCds.join(','),
    options.maxAutoMachines ?? '',
    options.partsPerPage ?? '',
    options.detailTopN ?? '',
  ].join('|');
}

export type SelfInspectionMachineBoardRotationViewModel = {
  targetMode: 'manual_machine_name' | 'auto_from_leaderboard_status';
  machineName: string;
  normalizedMachineName: string;
  updatedAt: Date;
  pages: SelfInspectionMachineBoardPage[];
  totalPages: number;
  scheduleRowCap: number;
  scheduleRowHasMore: boolean;
  loadedScheduleRowCount: number;
  autoTargetCount: number;
  autoTargetTruncated: boolean;
  autoTargetHitScanCap: boolean;
  autoTargetScanRowCap: number;
  autoTargetScannedRowCount: number;
};

function reindexMachineBoardPages(pages: SelfInspectionMachineBoardPage[]): SelfInspectionMachineBoardPage[] {
  const totalPages = pages.length;
  return pages.map((page, index) => ({
    ...page,
    pageIndex: index,
    pageCount: totalPages,
  }));
}

function applyAutoTargetPageMeta(
  pages: SelfInspectionMachineBoardPage[],
  selection: SelfInspectionMachineTargetSelectionResult
): SelfInspectionMachineBoardPage[] {
  return pages.map((page) => ({
    ...page,
    autoTargetTruncated: selection.truncated,
    autoTargetHitScanCap: selection.hitScanCap,
    autoTargetScanRowCap: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
  }));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await mapper(items[current]!);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function buildManualSelfInspectionMachineBoardRotationViewModel(options: {
  machineName: string;
  deviceScopeKey?: string;
  partsPerPage?: number;
  detailTopN?: number;
}): Promise<SelfInspectionMachineBoardRotationViewModel> {
  const vm = await buildSelfInspectionMachineBoardViewModel(options);
  return {
    targetMode: 'manual_machine_name',
    machineName: vm.machineName,
    normalizedMachineName: vm.normalizedMachineName,
    updatedAt: vm.updatedAt,
    pages: vm.pages,
    totalPages: vm.totalPages,
    scheduleRowCap: vm.scheduleRowCap,
    scheduleRowHasMore: vm.scheduleRowHasMore,
    loadedScheduleRowCount: vm.loadedScheduleRowCount,
    autoTargetCount: 0,
    autoTargetTruncated: false,
    autoTargetHitScanCap: false,
    autoTargetScanRowCap: 0,
    autoTargetScannedRowCount: 0,
  };
}

function logAutoTargetSelectionWarnings(
  options: {
    deviceScopeKey: string;
    resourceCds: string[];
    maxAutoMachines?: number;
  },
  selection: Awaited<ReturnType<typeof selectSelfInspectionMachineTargets>>
): void {
  if (selection.truncated) {
    logger.warn(
      {
        deviceScopeKey: options.deviceScopeKey,
        resourceCds: options.resourceCds,
        maxAutoMachines: options.maxAutoMachines,
        totalCandidateCount: selection.totalCandidateCount,
        selectedCount: selection.targets.length,
      },
      'self_inspection_machine_board auto targets were truncated'
    );
  }

  if (selection.hitScanCap) {
    logger.warn(
      {
        deviceScopeKey: options.deviceScopeKey,
        resourceCds: options.resourceCds,
        scannedRowCount: selection.scannedRowCount,
        scanRowCap: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
        selectedCount: selection.targets.length,
      },
      'self_inspection_machine_board auto target selector hit scan cap'
    );
  }
}

export async function buildAutoSelfInspectionMachineBoardRotationViewModel(options: {
  deviceScopeKey: string;
  resourceCds: string[];
  maxAutoMachines?: number;
  partsPerPage?: number;
  detailTopN?: number;
}): Promise<SelfInspectionMachineBoardRotationViewModel> {
  const cacheKey = buildAutoRotationVmCacheKey(options);
  const now = Date.now();
  const cached = getAutoRotationVmCache<SelfInspectionMachineBoardRotationViewModel>(cacheKey, now);
  if (cached) {
    return cached;
  }

  const pending = buildAutoSelfInspectionMachineBoardRotationViewModelUncached(options);
  setAutoRotationVmCache(
    cacheKey,
    now + SELF_INSPECTION_MACHINE_BOARD_AUTO_ROTATION_VM_CACHE_TTL_MS,
    pending
  );
  return pending;
}

async function buildAutoSelfInspectionMachineBoardRotationViewModelUncached(options: {
  deviceScopeKey: string;
  resourceCds: string[];
  maxAutoMachines?: number;
  partsPerPage?: number;
  detailTopN?: number;
}): Promise<SelfInspectionMachineBoardRotationViewModel> {
  const updatedAt = new Date();
  const selection = await selectSelfInspectionMachineTargets({
    deviceScopeKey: options.deviceScopeKey,
    resourceCds: options.resourceCds,
    maxAutoMachines: options.maxAutoMachines,
  });

  logAutoTargetSelectionWarnings(options, selection);

  if (selection.targets.length === 0) {
    return {
      targetMode: 'auto_from_leaderboard_status',
      machineName: '自動選定',
      normalizedMachineName: '',
      updatedAt,
      pages: [],
      totalPages: 0,
      scheduleRowCap: 0,
      scheduleRowHasMore: false,
      loadedScheduleRowCount: 0,
      autoTargetCount: 0,
      autoTargetTruncated: selection.truncated,
      autoTargetHitScanCap: selection.hitScanCap,
      autoTargetScanRowCap: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
      autoTargetScannedRowCount: selection.scannedRowCount,
    };
  }

  const viewModels = await mapWithConcurrency(
    selection.targets,
    SELF_INSPECTION_MACHINE_BOARD_AUTO_BUILD_CONCURRENCY,
    (target) =>
      buildSelfInspectionMachineBoardViewModel({
        machineName: target.machineName,
        deviceScopeKey: options.deviceScopeKey,
        partsPerPage: options.partsPerPage,
        detailTopN: options.detailTopN,
      })
  );

  const pages = applyAutoTargetPageMeta(
    reindexMachineBoardPages(viewModels.flatMap((vm) => vm.pages)),
    selection
  );
  const scheduleRowHasMore = viewModels.some((vm) => vm.scheduleRowHasMore);
  const scheduleRowCap = Math.max(...viewModels.map((vm) => vm.scheduleRowCap), 0);
  const loadedScheduleRowCount = viewModels.reduce((sum, vm) => sum + vm.loadedScheduleRowCount, 0);
  const primaryMachineName =
    selection.targets.length === 1
      ? selection.targets[0]!.machineName
      : `自動選定 ${selection.targets.length}機種`;

  return {
    targetMode: 'auto_from_leaderboard_status',
    machineName: primaryMachineName,
    normalizedMachineName:
      selection.targets.length === 1 ? selection.targets[0]!.normalizedMachineName : '',
    updatedAt,
    pages,
    totalPages: pages.length,
    scheduleRowCap,
    scheduleRowHasMore,
    loadedScheduleRowCount,
    autoTargetCount: selection.targets.length,
    autoTargetTruncated: selection.truncated,
    autoTargetHitScanCap: selection.hitScanCap,
    autoTargetScanRowCap: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
    autoTargetScannedRowCount: selection.scannedRowCount,
  };
}
