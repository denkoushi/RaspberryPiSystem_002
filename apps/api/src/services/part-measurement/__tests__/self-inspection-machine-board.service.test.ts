import { beforeEach, describe, expect, it, vi } from 'vitest';

const scanProductionScheduleRowsForSignageMachineBoard = vi.hoisted(() => vi.fn());
const buildLeaderboardDecorations = vi.hoisted(() => vi.fn());
const ensureSelfInspectionTemplatesForRows = vi.hoisted(() => vi.fn());
const ensureSelfInspectionSessionsInCache = vi.hoisted(() => vi.fn());

vi.mock('../../production-schedule/production-schedule-query.service.js', () => ({
  scanProductionScheduleRowsForSignageMachineBoard,
  normalizeMachineNameForCompare: (value: string) => value.trim().toLowerCase(),
}));

vi.mock('../self-inspection-machine-board.repository.js', () => ({
  fetchSelfInspectionSessionDetailsByScheduleRowIds: vi.fn(async () => new Map()),
}));

vi.mock('../../signage/leader-order-cards/resolve-signage-leader-order-location.js', () => ({
  resolveSignageLeaderOrderQueryKeys: vi.fn(async () => ({
    locationKey: 'kiosk-1',
    siteKey: undefined,
  })),
}));

vi.mock('../self-inspection.service.js', () => ({
  createSelfInspectionDecorationCache: vi.fn(async () => ({
    policy: {},
    templateByKey: new Map(),
    sessionsByScheduleRowId: new Map(),
  })),
  ensureSelfInspectionTemplatesForRows,
  ensureSelfInspectionSessionsInCache,
  SelfInspectionService: class {
    buildLeaderboardDecorations = buildLeaderboardDecorations;
  },
}));

import { buildSelfInspectionMachineBoardViewModel } from '../self-inspection-machine-board.service.js';

function makeRow(id: string, dueDate: Date | null) {
  return {
    id,
    rowData: {
      FSEIBAN: 'S1',
      ProductNo: id.replace('row-', '').padStart(4, '0'),
      FHINCD: `H-${id}`,
      FHINMEI: '品名',
    },
    dueDate,
    plannedQuantity: 1,
  };
}

describe('buildSelfInspectionMachineBoardViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('decorates schedule rows in scan pages instead of one bulk call', async () => {
    const pageOne = Array.from({ length: 500 }, (_, index) => makeRow(`row-${index + 1}`, null));
    const pageTwo = [
      ...Array.from({ length: 1500 }, (_, index) => makeRow(`row-${index + 501}`, null)),
      makeRow('row-in-progress', new Date('2026-06-01T00:00:00.000Z')),
    ];

    scanProductionScheduleRowsForSignageMachineBoard.mockImplementation(async (_params, onPage) => {
      await onPage(pageOne);
      await onPage(pageTwo);
      return { scheduleExhausted: true, hitScanCap: false, maxRows: 2000 };
    });

    buildLeaderboardDecorations.mockImplementation(async (inputRows: Array<{ id: string }>) =>
      inputRows.map((row) => ({
        id: row.id,
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: row.id === 'row-in-progress' ? 'in_progress' : 'completed',
        completedEntryCount: row.id === 'row-in-progress' ? 1 : 5,
        resolvedRequiredEntryCount: 5,
      }))
    );

    const vm = await buildSelfInspectionMachineBoardViewModel({
      machineName: '機種A',
      deviceScopeKey: 'Test - kiosk1',
    });

    expect(buildLeaderboardDecorations).toHaveBeenCalledTimes(2);
    expect(ensureSelfInspectionTemplatesForRows).toHaveBeenCalledTimes(2);
    expect(ensureSelfInspectionSessionsInCache).toHaveBeenCalledTimes(2);
    expect(ensureSelfInspectionSessionsInCache.mock.calls[0]?.[1]).toHaveLength(500);
    expect(ensureSelfInspectionSessionsInCache.mock.calls[1]?.[1]).toHaveLength(1501);

    const summaryPage = vm.pages.find((page) => page.kind === 'summary');
    const displayedIds =
      summaryPage && summaryPage.kind === 'summary'
        ? [...summaryPage.scheduled, ...summaryPage.unscheduled].flatMap((group) =>
            group.parts.map((part) => part.scheduleRowId)
          )
        : [];

    expect(displayedIds).toContain('row-in-progress');
    expect(vm.loadedScheduleRowCount).toBe(2000);
    expect(vm.scheduleRowHasMore).toBe(true);
    expect(vm.scheduleRowCap).toBe(2000);
  });
});
