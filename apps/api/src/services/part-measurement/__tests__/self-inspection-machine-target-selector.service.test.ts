import { beforeEach, describe, expect, it, vi } from 'vitest';

const scanProductionScheduleRowsForSignageAutoTargetSelector = vi.hoisted(() => vi.fn());
const decorateRowsForSelfInspectionMachineTargetSelector = vi.hoisted(() => vi.fn());
const createSelfInspectionDecorationCache = vi.hoisted(() => vi.fn());

vi.mock('../../production-schedule/production-schedule-query.service.js', () => ({
  scanProductionScheduleRowsForSignageAutoTargetSelector,
  decorateRowsForSelfInspectionMachineTargetSelector,
}));

vi.mock('../self-inspection.service.js', () => ({
  createSelfInspectionDecorationCache,
}));

vi.mock('../../signage/leader-order-cards/resolve-signage-leader-order-location.js', () => ({
  resolveSignageLeaderOrderQueryKeys: vi.fn(async () => ({
    locationKey: 'kiosk-1',
    siteKey: '第2工場',
  })),
}));

import { SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL } from '../../production-schedule/constants.js';
import { MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS } from '../../signage/self-inspection-machine-board/layout-contracts.js';
import { selectSelfInspectionMachineTargets } from '../self-inspection-machine-target-selector.service.js';

function makeRawRow(
  id: string,
  resourceCd: string,
  dueDate: Date | null,
  plannedEndDate: Date | null = null
) {
  return {
    id,
    rowData: {
      FSEIBAN: `S-${id}`,
      ProductNo: '1001',
      FHINCD: `H-${id}`,
      FHINMEI: '品名',
      FKOJUN: '10',
      FSIGENCD: resourceCd,
      progress: '仕掛',
    },
    dueDate,
    plannedEndDate,
    plannedQuantity: 1,
    processingOrder: null,
    globalRank: null,
    note: null,
    processingType: null,
    plannedStartDate: null,
    seibanJoinKey: `S-${id}`,
    occurredAt: new Date('2026-06-01T00:00:00.000Z'),
  };
}

describe('selectSelfInspectionMachineTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createSelfInspectionDecorationCache.mockResolvedValue({ policy: {}, templateByKey: new Map(), sessionsByScheduleRowId: new Map() });
    scanProductionScheduleRowsForSignageAutoTargetSelector.mockImplementation(
      async (_params, onPage: (rows: ReturnType<typeof makeRawRow>[]) => Promise<void> | void) => {
        await onPage([]);
        return {
          scheduleExhausted: true,
          hitScanCap: false,
          scannedRowCount: 0,
          maxRows: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
        };
      }
    );
  });

  it('selects only machines with in_progress rows and deduplicates normalized names', async () => {
    scanProductionScheduleRowsForSignageAutoTargetSelector.mockImplementation(
      async (_params, onPage) => {
        await onPage([
          makeRawRow('row-1', 'RD01', new Date('2026-06-02T00:00:00.000Z')),
          makeRawRow('row-2', 'RD01', new Date('2026-06-01T00:00:00.000Z')),
          makeRawRow('row-3', 'RD02', new Date('2026-06-03T00:00:00.000Z')),
        ]);
        return {
          scheduleExhausted: true,
          hitScanCap: false,
          scannedRowCount: 3,
          maxRows: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
        };
      }
    );
    decorateRowsForSelfInspectionMachineTargetSelector.mockResolvedValue([
      {
        id: 'row-1',
        resolvedMachineName: 'L300KP',
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
      {
        id: 'row-2',
        resolvedMachineName: 'l300kp',
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'completed',
      },
      {
        id: 'row-3',
        resolvedMachineName: 'M200',
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'not_started',
      },
    ]);

    const result = await selectSelfInspectionMachineTargets({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 5,
    });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]).toMatchObject({
      machineName: 'L300KP',
      normalizedMachineName: 'L300KP',
      inProgressCount: 1,
      sourceRowCount: 2,
    });
    expect(result.targets[0]?.earliestDueDate?.toISOString()).toBe('2026-06-02T00:00:00.000Z');
    expect(result.totalCandidateCount).toBe(1);
    expect(result.truncated).toBe(false);
    expect(createSelfInspectionDecorationCache).toHaveBeenCalledWith({
      siteKey: '第2工場',
      resourceCds: ['RD01'],
    });
  });

  it('excludes 機種名未登録 even when it has the most in_progress rows', async () => {
    scanProductionScheduleRowsForSignageAutoTargetSelector.mockImplementation(
      async (_params, onPage) => {
        await onPage([
          makeRawRow('row-u1', 'RD01', null),
          makeRawRow('row-u2', 'RD01', null),
          makeRawRow('row-v1', 'RD01', null),
        ]);
        return {
          scheduleExhausted: true,
          hitScanCap: false,
          scannedRowCount: 3,
          maxRows: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
        };
      }
    );
    decorateRowsForSelfInspectionMachineTargetSelector.mockResolvedValue([
      {
        id: 'row-u1',
        resolvedMachineName: SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL,
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
      {
        id: 'row-u2',
        resolvedMachineName: SEIBAN_MACHINE_NAME_UNREGISTERED_LABEL,
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
      {
        id: 'row-v1',
        resolvedMachineName: 'L300KP',
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
    ]);

    const result = await selectSelfInspectionMachineTargets({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 1,
    });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.machineName).toBe('L300KP');
    expect(result.totalCandidateCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('paginates schedule rows until exhausted or scan cap', async () => {
    scanProductionScheduleRowsForSignageAutoTargetSelector.mockImplementation(
      async (_params, onPage) => {
        await onPage(
          Array.from({ length: 500 }, (_, index) => makeRawRow(`page1-${index}`, 'RD01', null))
        );
        await onPage([makeRawRow('page2-target', 'RD01', new Date('2026-06-02T00:00:00.000Z'))]);
        return {
          scheduleExhausted: true,
          hitScanCap: false,
          scannedRowCount: 501,
          maxRows: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
        };
      }
    );
    decorateRowsForSelfInspectionMachineTargetSelector.mockImplementation(
      async ({ rows }: { rows: Array<{ id: string }> }) =>
        rows.map((row) => ({
          id: row.id,
          resolvedMachineName: row.id === 'page2-target' ? 'L300KP' : 'M200',
          hasSelfInspectionDrawing: true,
          selfInspectionStatus: row.id === 'page2-target' ? 'in_progress' : 'not_started',
        }))
    );

    const result = await selectSelfInspectionMachineTargets({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 5,
    });

    expect(scanProductionScheduleRowsForSignageAutoTargetSelector).toHaveBeenCalledTimes(1);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.machineName).toBe('L300KP');
    expect(result.hitScanCap).toBe(false);
    expect(result.scannedRowCount).toBe(501);
  });

  it('does not set hitScanCap when scan ends exactly at cap with no further rows', async () => {
    scanProductionScheduleRowsForSignageAutoTargetSelector.mockResolvedValue({
      scheduleExhausted: true,
      hitScanCap: false,
      scannedRowCount: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
      maxRows: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
    });
    decorateRowsForSelfInspectionMachineTargetSelector.mockResolvedValue([]);

    const result = await selectSelfInspectionMachineTargets({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
    });

    expect(result.hitScanCap).toBe(false);
    expect(result.scannedRowCount).toBe(2000);
  });

  it('uses plannedEndDate for tie-break when manual due is absent', async () => {
    scanProductionScheduleRowsForSignageAutoTargetSelector.mockImplementation(
      async (_params, onPage) => {
        await onPage([
          makeRawRow('row-a', 'RD01', null, new Date('2026-06-15T00:00:00.000Z')),
          makeRawRow('row-b', 'RD01', null, new Date('2026-06-01T00:00:00.000Z')),
        ]);
        return {
          scheduleExhausted: true,
          hitScanCap: false,
          scannedRowCount: 2,
          maxRows: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
        };
      }
    );
    decorateRowsForSelfInspectionMachineTargetSelector.mockResolvedValue([
      {
        id: 'row-a',
        resolvedMachineName: 'Machine-A',
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
      {
        id: 'row-b',
        resolvedMachineName: 'Machine-B',
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
    ]);

    const result = await selectSelfInspectionMachineTargets({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 1,
    });

    expect(result.targets).toHaveLength(1);
    expect(result.targets[0]?.machineName).toBe('Machine-B');
    expect(result.targets[0]?.earliestDueDate?.toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(result.truncated).toBe(true);
  });

  it('excludes rows without resolvedMachineName and truncates by maxAutoMachines', async () => {
    scanProductionScheduleRowsForSignageAutoTargetSelector.mockImplementation(
      async (_params, onPage) => {
        await onPage([
          makeRawRow('row-a', 'RD01', null),
          makeRawRow('row-b', 'RD01', null),
          makeRawRow('row-c', 'RD01', null),
        ]);
        return {
          scheduleExhausted: true,
          hitScanCap: false,
          scannedRowCount: 3,
          maxRows: MAX_SELF_INSPECTION_MACHINE_TARGET_SELECTOR_ROWS,
        };
      }
    );
    decorateRowsForSelfInspectionMachineTargetSelector.mockResolvedValue([
      {
        id: 'row-a',
        resolvedMachineName: 'A',
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
      {
        id: 'row-b',
        resolvedMachineName: null,
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
      {
        id: 'row-c',
        resolvedMachineName: 'C',
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
      },
    ]);

    const result = await selectSelfInspectionMachineTargets({
      deviceScopeKey: '第2工場 - kensakuMain',
      resourceCds: ['RD01'],
      maxAutoMachines: 1,
    });

    expect(result.targets).toHaveLength(1);
    expect(result.totalCandidateCount).toBe(2);
    expect(result.truncated).toBe(true);
  });
});
