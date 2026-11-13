import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma, ProductionScheduleGrindingPlanningBoardOverride as Override } from '@prisma/client';
import { buildGrindingPlanningBoardRowItemId, projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { updateGrindingPlanningBoardOverrides, writeOverrideIfChanged } from '../grinding-planning-board/write.js';

const mocks = vi.hoisted(() => ({
  tx: { $queryRaw: vi.fn(), $transaction: vi.fn(), productionScheduleGrindingPlanningBoardOverride: { upsert: vi.fn() } },
  source: { readWinnerRowsByIds: vi.fn(), readWinnerRowsByLogicalKeyFseibans: vi.fn(), readRowDetails: vi.fn(), readRanks: vi.fn(), readOverrides: vi.fn(), readMasterResourceCds: vi.fn() }
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.tx }));
vi.mock('../grinding-planning-board/source.js', () => mocks.source);
vi.mock('../grinding-planning-board/state.js', () => ({
  ensurePlanningBoardState: vi.fn(), lockState: vi.fn(), readState: vi.fn().mockResolvedValue({ seibanOrder: ['S'] }),
  stateOrder: () => ['S'], boardRevision: () => 'board', assertBoardRevision: vi.fn()
}));
vi.mock('../sessaku-pieces/piece-key.js', async (original) => ({
  ...await original<typeof import('../sessaku-pieces/piece-key.js')>(),
  readSessakuPieceSets: vi.fn().mockResolvedValue(new Map()), acquireSessakuPieceLogicalLocks: vi.fn()
}));
vi.mock('../order-assignment/production-schedule-parent-row-lock.service.js', () => ({ acquireProductionScheduleParentRowLockInTransaction: vi.fn() }));
vi.mock('../grinding-planning-board-resource-minutes.service.js', () => ({ getGrindingPlanningBoardResourceMinutes: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: vi.fn().mockResolvedValue({ cuttingExcludedResourceCds: [] }),
  normalizeProductionScheduleResourceCd: (value: string) => value, isProductionScheduleGrindingResourceCd: () => true, isProductionScheduleCuttingResourceCd: () => false
}));

const row = { id: 'row', updatedAt: null, rowData: { FSEIBAN: 'S', FHINCD: 'P', FSIGENCD: '305', FKOJUN: '1' } };
const itemKey = buildGrindingPlanningBoardRowItemId(row.rowData);
const detail = { updatedAt: null, rowNotes: [], orderSupplements: [], productionScheduleProgress: null,
  productionScheduleExternalCompletion: null, excelDueDate: new Date('2026-11-13'), excelChangedAt: new Date('2026-10-31') };
const savedOverride = (extra: Partial<Override> = {}): Override => ({
  id: 'override', csvDashboardId: 'dashboard', siteKey: 'site', itemKey, overrideResourceCd: null,
  overrideDueDate: new Date('2026-11-02'), overrideDueDateSetAt: null, dueDateCleared: false, alternateRank: null,
  orderPinned: false, specialDueKind: null, specialDueExpiresAt: null, version: 1, createdAt: new Date(0), updatedAt: new Date(0), ...extra
});

describe('planning due input timestamps', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-01T00:00:00Z')); });
  afterEach(() => vi.useRealTimers());

  it.each([
    { name: 'new due', current: undefined, date: '2026-11-02', writes: true },
    { name: 'same inactive stored due', current: savedOverride(), date: '2026-11-02', writes: true },
    { name: 'same effective Excel due', current: savedOverride({ alternateRank: 5 }), date: '2026-11-13', writes: false }
  ])('$name', async ({ current, date, writes }) => {
    const overrides = new Map(current ? [[itemKey, current]] : []);
    mocks.source.readWinnerRowsByIds.mockResolvedValue([row]);
    mocks.source.readWinnerRowsByLogicalKeyFseibans.mockResolvedValue([row]);
    mocks.source.readRowDetails.mockResolvedValue(new Map([['row', detail]]));
    mocks.source.readRanks.mockResolvedValue({ rows: new Map() });
    mocks.source.readOverrides.mockResolvedValue(overrides);
    mocks.source.readMasterResourceCds.mockResolvedValue(new Set(['305']));
    mocks.tx.$queryRaw.mockResolvedValue([{ id: 'row' }]);
    mocks.tx.$transaction.mockImplementation(async (callback) => callback(mocks.tx));
    mocks.tx.productionScheduleGrindingPlanningBoardOverride.upsert.mockImplementation(async ({ create, update }) => ({
      ...savedOverride(), ...create, ...update, version: 2
    }));
    const item = projectGrindingPlanningBoard({ rows: [row], details: new Map([['row', detail]]),
      ranks: { rows: new Map() }, overrides, seibanOrder: ['S'], category: 'grinding', isResourceInCategory: () => true }).items[0];
    const result = await updateGrindingPlanningBoardOverrides({ siteKey: 'site', sourceRevision: 'board', items: [{
      itemId: itemKey, itemRevision: item.itemRevision, overrideVersion: item.version, due: { kind: 'date', date }
    }] });
    expect(result.items[0].effectiveDueDate).toBe(date);
    if (!writes) {
      expect(mocks.tx.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
      expect(result.items[0].alternateRank).toBe(5);
      return;
    }
    expect(mocks.tx.productionScheduleGrindingPlanningBoardOverride.upsert).toHaveBeenCalledOnce();
    const write = mocks.tx.productionScheduleGrindingPlanningBoardOverride.upsert.mock.calls[0][0];
    for (const data of [write.create, write.update]) {
      expect(data.overrideDueDateSetAt).toEqual(new Date());
      expect(data.overrideDueDate).toEqual(new Date('2026-11-02'));
    }
  });

  it.each([null, new Date('2026-10-30T12:34:56.789Z')])('preserves the timestamp on rank-only writes (%s)', async (timestamp) => {
    const current = savedOverride({ overrideDueDateSetAt: timestamp });
    const { overrideDueDateSetAt: _timestamp, ...unchanged } = current;
    await writeOverrideIfChanged(mocks.tx as unknown as Prisma.TransactionClient, 'site', itemKey, current, { ...unchanged, alternateRank: 2 });
    const write = mocks.tx.productionScheduleGrindingPlanningBoardOverride.upsert.mock.calls[0][0];
    expect(write.create.overrideDueDateSetAt).toEqual(timestamp);
    expect(write.update.overrideDueDateSetAt).toEqual(timestamp);
  });
});
