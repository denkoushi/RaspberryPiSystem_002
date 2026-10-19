import { beforeEach, describe, expect, it, vi } from 'vitest';

const scanProductionScheduleRowsForSignageMachineBoard = vi.hoisted(() => vi.fn());
const buildLeaderboardDecorations = vi.hoisted(() => vi.fn());
const ensureSelfInspectionTemplatesForRows = vi.hoisted(() => vi.fn());
const ensureSelfInspectionSessionsInCache = vi.hoisted(() => vi.fn());
const fetchSelfInspectionMachineBoardOutcomeRecordsByScheduleRowIds = vi.hoisted(() =>
  vi.fn(async () => new Map())
);
const getResourceNameMapByResourceCds = vi.hoisted(() =>
  vi.fn(async () => ({ R01: ['研削一号機'] }))
);

vi.mock('../../production-schedule/production-schedule-query.service.js', () => ({
  scanProductionScheduleRowsForSignageMachineBoard,
  normalizeMachineNameForCompare: (value: string) => value.trim().toLowerCase(),
}));

vi.mock('../self-inspection-machine-board.repository.js', () => ({
  fetchSelfInspectionSessionDetailsByScheduleRowIds: vi.fn(async () => new Map()),
  fetchSelfInspectionMachineBoardOutcomeRecordsByScheduleRowIds,
}));

vi.mock('../../production-schedule/resource-master.service.js', () => ({
  getResourceNameMapByResourceCds,
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

function makeRow(
  id: string,
  dueDate: Date | null,
  rowData: Record<string, string> = {}
) {
  return {
    id,
    rowData: {
      FSEIBAN: 'S1',
      ProductNo: id.replace('row-', '').padStart(4, '0'),
      FHINCD: `H-${id}`,
      FHINMEI: '品名',
      ...rowData,
    },
    dueDate,
    plannedQuantity: 1,
  };
}

describe('buildSelfInspectionMachineBoardViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getResourceNameMapByResourceCds.mockResolvedValue({ R01: ['研削一号機'] });
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

  it('sorts cards by scheduled due date before outcome status', async () => {
    const early = makeRow('row-early', new Date('2026-06-01T00:00:00.000Z'), {
      ProductNo: 'P1',
      FHINCD: 'H1',
    });
    const late = makeRow('row-late', new Date('2026-06-02T00:00:00.000Z'), {
      ProductNo: 'P2',
      FHINCD: 'H2',
    });

    scanProductionScheduleRowsForSignageMachineBoard.mockImplementation(async (_params, onPage) => {
      await onPage([late, early]);
      return { scheduleExhausted: true, hitScanCap: false, maxRows: 2000 };
    });
    buildLeaderboardDecorations.mockImplementation(async (inputRows: Array<{ id: string }>) =>
      inputRows.map((row) =>
        row.id === 'row-late'
          ? {
              id: row.id,
              hasSelfInspectionDrawing: true,
              selfInspectionStatus: 'in_progress',
              completedEntryCount: 0,
              resolvedRequiredEntryCount: 1,
              pendingReviewCount: 1,
            }
          : {
              id: row.id,
              hasSelfInspectionDrawing: true,
              selfInspectionStatus: 'completed',
              completedEntryCount: 1,
              resolvedRequiredEntryCount: 1,
            }
      )
    );

    const vm = await buildSelfInspectionMachineBoardViewModel({
      machineName: '機種A',
      partsPerPage: 10,
    });
    const summaryPage = vm.pages.find((page) => page.kind === 'summary');
    const scheduledParts =
      summaryPage && summaryPage.kind === 'summary'
        ? summaryPage.scheduled[0]?.parts.map((part) => part.scheduleRowId)
        : [];

    expect(scheduledParts).toEqual(['row-early', 'row-late']);
  });

  it('adds Japanese resource names to manual-mode cards in one batch', async () => {
    const row = makeRow('row-resource', null, { FSIGENCD: 'R01' });
    scanProductionScheduleRowsForSignageMachineBoard.mockImplementation(async (_params, onPage) => {
      await onPage([row]);
      return { scheduleExhausted: true, hitScanCap: false, maxRows: 2000 };
    });
    buildLeaderboardDecorations.mockResolvedValue([
      {
        id: row.id,
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
        completedEntryCount: 1,
        resolvedRequiredEntryCount: 2,
      },
    ]);

    const vm = await buildSelfInspectionMachineBoardViewModel({ machineName: '機種A' });
    const summary = vm.pages.find((page) => page.kind === 'summary');
    const resource = summary?.kind === 'summary'
      ? [...summary.scheduled, ...summary.unscheduled][0]?.parts[0]?.resources?.[0]
      : undefined;

    expect(getResourceNameMapByResourceCds).toHaveBeenCalledTimes(1);
    expect(getResourceNameMapByResourceCds).toHaveBeenCalledWith(['R01']);
    expect(resource?.resourceDisplayName).toBe('研削一号機');
  });

  it('propagates the selected manual session updatedAt to the card', async () => {
    const row = makeRow('row-updated-at', null, { FSIGENCD: 'R01' });
    const updatedAt = new Date('2026-08-25T02:00:00.000Z');
    scanProductionScheduleRowsForSignageMachineBoard.mockImplementation(async (_params, onPage) => {
      await onPage([row]);
      return { scheduleExhausted: true, hitScanCap: false, maxRows: 2000 };
    });
    buildLeaderboardDecorations.mockResolvedValue([
      {
        id: row.id,
        hasSelfInspectionDrawing: true,
        selfInspectionStatus: 'in_progress',
        completedEntryCount: 1,
        resolvedRequiredEntryCount: 2,
      },
    ]);
    fetchSelfInspectionMachineBoardOutcomeRecordsByScheduleRowIds.mockResolvedValue(
      new Map([
        [
          row.id,
          {
            scheduleRowId: row.id,
            sessionId: 'session-1',
            plannedQuantity: 1,
            expectedEntryCount: 2,
            confirmedEntryCount: 1,
            updatedAt,
          },
        ],
      ])
    );

    const vm = await buildSelfInspectionMachineBoardViewModel({ machineName: '機種A' });
    const summary = vm.pages.find((page) => page.kind === 'summary');
    const card = summary?.kind === 'summary'
      ? [...summary.scheduled, ...summary.unscheduled][0]?.parts[0]
      : undefined;

    expect(card?.updatedAt).toBe(updatedAt);
  });
});
