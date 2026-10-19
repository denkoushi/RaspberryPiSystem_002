import { beforeEach, describe, expect, it, vi } from 'vitest';

const buildSelfInspectionMachineBoardViewModel = vi.hoisted(() => vi.fn());
const buildKioskActiveSelfInspectionMachineBoardViewModel = vi.hoisted(() => vi.fn());
const selectSelfInspectionMachineTargets = vi.hoisted(() => vi.fn());

vi.mock('../self-inspection-machine-board.service.js', () => ({
  buildSelfInspectionMachineBoardViewModel,
}));

vi.mock('../self-inspection-machine-board-active.service.js', () => ({
  buildKioskActiveSelfInspectionMachineBoardViewModel,
}));

vi.mock('../self-inspection-machine-target-selector.service.js', () => ({
  selectSelfInspectionMachineTargets,
}));

import {
  buildAutoSelfInspectionMachineBoardRotationViewModel,
  buildKioskActiveSelfInspectionMachineBoardRotationViewModel,
  buildManualSelfInspectionMachineBoardRotationViewModel,
  clearAutoSelfInspectionMachineBoardRotationViewModelCacheForTests,
} from '../self-inspection-machine-board-rotation.service.js';
import { resetSelfInspectionMachineBoardScheduleRowCaches } from '../self-inspection-machine-board-cache-invalidation.js';

function makeBoardCard(machineName: string, index: number) {
  return {
    scheduleRowId: `${machineName}-row-${index}`,
    cardKey: `${machineName}::card-${index}`,
    fseiban: `${machineName}-S-${index}`,
    productNo: `${machineName}-P-${index}`,
    fhincd: `${machineName}-H-${index}`,
    fhinmei: `${machineName}-Name-${index}`,
    machineName,
    normalizedMachineName: machineName.toLowerCase(),
    status: 'in_progress' as const,
    outcome: 'in_progress' as const,
    completedEntryCount: 1,
    confirmedEntryCount: 1,
    requiredEntryCount: 2,
    progressLabel: '1/2',
    dueDate: null,
    isScheduled: false,
    resources: [],
    resourceCds: [],
    scheduleRowIds: [`${machineName}-row-${index}`],
  };
}

describe('self-inspection-machine-board-rotation.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAutoSelfInspectionMachineBoardRotationViewModelCacheForTests();
  });

  it('passes through manual view model', async () => {
    buildSelfInspectionMachineBoardViewModel.mockResolvedValue({
      machineName: 'L300KP',
      normalizedMachineName: 'l300kp',
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
      pages: [
        {
          kind: 'summary',
          machineName: 'L300KP',
          updatedAt: new Date('2026-06-09T00:00:00.000Z'),
          scheduled: [],
          unscheduled: [],
          pageIndex: 0,
          pageCount: 1,
        },
      ],
      totalPages: 1,
      scheduleRowCap: 2000,
      scheduleRowHasMore: false,
      loadedScheduleRowCount: 1,
    });

    const vm = await buildManualSelfInspectionMachineBoardRotationViewModel({
      machineName: 'L300KP',
      partsPerPage: 12,
      detailTopN: 5,
    });

    expect(vm.targetMode).toBe('manual_machine_name');
    expect(vm.totalPages).toBe(1);
    expect(vm.autoTargetCount).toBe(0);
  });

  it('builds kiosk_active_sessions on every call without using the rotation cache', async () => {
    buildKioskActiveSelfInspectionMachineBoardViewModel.mockResolvedValue({
      machineName: 'キオスク自主検査',
      normalizedMachineName: '',
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
      pages: [],
      totalPages: 0,
      scheduleRowCap: 200,
      scheduleRowHasMore: true,
      loadedScheduleRowCount: 200,
      activeSessionLimit: 200,
      activeSessionHasMore: true,
      activeSessionCount: 200,
    });

    const first = await buildKioskActiveSelfInspectionMachineBoardRotationViewModel({
      partsPerPage: 6,
      detailTopN: 5,
    });
    const second = await buildKioskActiveSelfInspectionMachineBoardRotationViewModel({
      partsPerPage: 6,
      detailTopN: 5,
    });

    expect(first.targetMode).toBe('kiosk_active_sessions');
    expect(second.activeSessionHasMore).toBe(true);
    expect(buildKioskActiveSelfInspectionMachineBoardViewModel).toHaveBeenCalledTimes(2);
  });

  it('reindexes pages across multiple auto-selected machines', async () => {
    selectSelfInspectionMachineTargets.mockResolvedValue({
      targets: [
        {
          machineName: 'A',
          normalizedMachineName: 'a',
          inProgressCount: 2,
          earliestDueDate: null,
          sourceRowCount: 2,
        },
        {
          machineName: 'B',
          normalizedMachineName: 'b',
          inProgressCount: 1,
          earliestDueDate: null,
          sourceRowCount: 1,
        },
      ],
      totalCandidateCount: 2,
      truncated: false,
      hitScanCap: false,
      scannedRowCount: 3,
    });
    buildSelfInspectionMachineBoardViewModel
      .mockResolvedValueOnce({
        machineName: 'A',
        normalizedMachineName: 'a',
        updatedAt: new Date('2026-06-09T00:00:00.000Z'),
        pages: [
          {
            kind: 'summary',
            machineName: 'A',
            updatedAt: new Date('2026-06-09T00:00:00.000Z'),
            scheduled: [],
            unscheduled: [{ fseiban: 'A-S-0', dueDate: null, parts: [makeBoardCard('A', 0)] }],
            pageIndex: 0,
            pageCount: 2,
          },
          {
            kind: 'summary',
            machineName: 'A',
            updatedAt: new Date('2026-06-09T00:00:00.000Z'),
            scheduled: [],
            unscheduled: [{ fseiban: 'A-S-1', dueDate: null, parts: [makeBoardCard('A', 1)] }],
            pageIndex: 1,
            pageCount: 2,
          },
        ],
        totalPages: 2,
        scheduleRowCap: 2000,
        scheduleRowHasMore: false,
        loadedScheduleRowCount: 2,
      })
      .mockResolvedValueOnce({
        machineName: 'B',
        normalizedMachineName: 'b',
        updatedAt: new Date('2026-06-09T00:00:00.000Z'),
        pages: [
          {
            kind: 'summary',
            machineName: 'B',
            updatedAt: new Date('2026-06-09T00:00:00.000Z'),
            scheduled: [],
            unscheduled: [{ fseiban: 'B-S-0', dueDate: null, parts: [makeBoardCard('B', 0)] }],
            pageIndex: 0,
            pageCount: 1,
          },
        ],
        totalPages: 1,
        scheduleRowCap: 2000,
        scheduleRowHasMore: false,
        loadedScheduleRowCount: 1,
      });

    const vm = await buildAutoSelfInspectionMachineBoardRotationViewModel({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 5,
      partsPerPage: 2,
      detailTopN: 5,
    });

    expect(vm.targetMode).toBe('auto_from_leaderboard_status');
    expect(vm.totalPages).toBe(2);
    expect(vm.pages.map((page) => page.pageIndex)).toEqual([0, 1]);
    expect(vm.pages.every((page) => page.pageCount === 2)).toBe(true);
    expect(vm.autoTargetCount).toBe(2);
    expect(vm.scheduleRowHasMore).toBe(false);
    expect(vm.pages[0]).toMatchObject({
      autoTargetTruncated: false,
      autoTargetHitScanCap: false,
      autoTargetScanRowCap: 2000,
    });
  });

  it('keeps auto scan metadata on pages without mixing into scheduleRowHasMore', async () => {
    selectSelfInspectionMachineTargets.mockResolvedValue({
      targets: [
        {
          machineName: 'A',
          normalizedMachineName: 'a',
          inProgressCount: 2,
          earliestDueDate: null,
          sourceRowCount: 2,
        },
      ],
      totalCandidateCount: 3,
      truncated: true,
      hitScanCap: true,
      scannedRowCount: 2000,
    });
    buildSelfInspectionMachineBoardViewModel.mockResolvedValue({
      machineName: 'A',
      normalizedMachineName: 'a',
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
      pages: [
        {
          kind: 'summary',
          machineName: 'A',
          updatedAt: new Date('2026-06-09T00:00:00.000Z'),
          scheduled: [],
          unscheduled: [{ fseiban: 'A-S-0', dueDate: null, parts: [makeBoardCard('A', 0)] }],
          pageIndex: 0,
          pageCount: 1,
          scheduleRowCap: 2000,
          scheduleRowHasMore: false,
        },
      ],
      totalPages: 1,
      scheduleRowCap: 2000,
      scheduleRowHasMore: false,
      loadedScheduleRowCount: 1,
    });

    const vm = await buildAutoSelfInspectionMachineBoardRotationViewModel({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 1,
    });

    expect(vm.scheduleRowHasMore).toBe(false);
    expect(vm.autoTargetTruncated).toBe(true);
    expect(vm.autoTargetHitScanCap).toBe(true);
    expect(vm.pages[0]).toMatchObject({
      scheduleRowHasMore: false,
      autoTargetTruncated: true,
      autoTargetHitScanCap: true,
      autoTargetScanRowCap: 2000,
    });
  });

  it('returns empty auto view model when no targets are found', async () => {
    selectSelfInspectionMachineTargets.mockResolvedValue({
      targets: [],
      totalCandidateCount: 0,
      truncated: false,
      hitScanCap: false,
      scannedRowCount: 0,
    });

    const vm = await buildAutoSelfInspectionMachineBoardRotationViewModel({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
    });

    expect(vm.totalPages).toBe(0);
    expect(vm.autoTargetCount).toBe(0);
    expect(vm.scheduleRowHasMore).toBe(false);
    expect(vm.autoTargetScanRowCap).toBe(2000);
    expect(vm.autoTargetScannedRowCount).toBe(0);
  });

  it('reuses cached auto rotation view model within TTL', async () => {
    selectSelfInspectionMachineTargets.mockResolvedValue({
      targets: [
        {
          machineName: 'A',
          normalizedMachineName: 'a',
          inProgressCount: 1,
          earliestDueDate: null,
          sourceRowCount: 1,
        },
      ],
      totalCandidateCount: 1,
      truncated: false,
      hitScanCap: false,
      scannedRowCount: 1,
    });
    buildSelfInspectionMachineBoardViewModel.mockResolvedValue({
      machineName: 'A',
      normalizedMachineName: 'a',
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
      pages: [
        {
          kind: 'summary',
          machineName: 'A',
          updatedAt: new Date('2026-06-09T00:00:00.000Z'),
          scheduled: [],
          unscheduled: [],
          pageIndex: 0,
          pageCount: 1,
        },
      ],
      totalPages: 1,
      scheduleRowCap: 2000,
      scheduleRowHasMore: false,
      loadedScheduleRowCount: 1,
    });

    const options = {
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 5,
      partsPerPage: 12,
      detailTopN: 5,
    };

    await buildAutoSelfInspectionMachineBoardRotationViewModel(options);
    await buildAutoSelfInspectionMachineBoardRotationViewModel(options);

    expect(selectSelfInspectionMachineTargets).toHaveBeenCalledTimes(1);
    expect(buildSelfInspectionMachineBoardViewModel).toHaveBeenCalledTimes(1);
  });

  it('rebuilds auto rotation view model after repository reset', async () => {
    selectSelfInspectionMachineTargets.mockResolvedValue({
      targets: [
        {
          machineName: 'A',
          normalizedMachineName: 'a',
          inProgressCount: 1,
          earliestDueDate: null,
          sourceRowCount: 1,
        },
      ],
      totalCandidateCount: 1,
      truncated: false,
      hitScanCap: false,
      scannedRowCount: 1,
    });
    buildSelfInspectionMachineBoardViewModel.mockResolvedValue({
      machineName: 'A',
      normalizedMachineName: 'a',
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
      pages: [
        {
          kind: 'summary',
          machineName: 'A',
          updatedAt: new Date('2026-06-09T00:00:00.000Z'),
          scheduled: [],
          unscheduled: [],
          pageIndex: 0,
          pageCount: 1,
        },
      ],
      totalPages: 1,
      scheduleRowCap: 2000,
      scheduleRowHasMore: false,
      loadedScheduleRowCount: 1,
    });

    const options = {
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 5,
      partsPerPage: 12,
      detailTopN: 5,
    };

    await buildAutoSelfInspectionMachineBoardRotationViewModel(options);
    resetSelfInspectionMachineBoardScheduleRowCaches();
    await buildAutoSelfInspectionMachineBoardRotationViewModel(options);

    expect(selectSelfInspectionMachineTargets).toHaveBeenCalledTimes(2);
    expect(buildSelfInspectionMachineBoardViewModel).toHaveBeenCalledTimes(2);
  });

  it('keeps auto scan metadata when no targets are found but scan cap was hit', async () => {
    selectSelfInspectionMachineTargets.mockResolvedValue({
      targets: [],
      totalCandidateCount: 0,
      truncated: false,
      hitScanCap: true,
      scannedRowCount: 2000,
    });

    const vm = await buildAutoSelfInspectionMachineBoardRotationViewModel({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
    });

    expect(vm.autoTargetHitScanCap).toBe(true);
    expect(vm.scheduleRowHasMore).toBe(false);
    expect(vm.autoTargetScannedRowCount).toBe(2000);
    expect(vm.autoTargetScanRowCap).toBe(2000);
  });
});
