import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ count: vi.fn(), reorder: vi.fn(), legacy: vi.fn(), transaction: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  productionScheduleGrindingPlanningBoardTestBar: { count: mocks.count },
  productionScheduleSessakuPieceSet: { findMany: vi.fn(async () => []) },
  $transaction: mocks.transaction
} }));
vi.mock('../grinding-planning-board/test-bars.js', async (original) => ({
  ...await original<typeof import('../grinding-planning-board/test-bars.js')>(), reorderPlanningTestBarLane: mocks.reorder
}));
vi.mock('../grinding-planning-board/state.js', () => ({
  getOrCreateState: vi.fn(async () => ({})), lockState: vi.fn(async () => ({})),
  assertBoardRevision: vi.fn(), stateOrder: () => ['lot'], ensurePlanningBoardState: vi.fn()
}));
vi.mock('../grinding-planning-board/source.js', () => ({
  readOverrides: vi.fn(async () => new Map([['row:source', { overrideResourceCd: '10' }]])),
  readWinnerRowsByFseibans: vi.fn(async () => [
    { id: 'source', rowData: { FSEIBAN: 'lot', FSIGENCD: '20' } },
    { id: 'target', rowData: { FSEIBAN: 'lot', FSIGENCD: '10' } }
  ])
}));
vi.mock('../grinding-planning-board-projection.js', () => ({
  buildGrindingPlanningBoardRowItemId: (row: { FSIGENCD: string }) => row.FSIGENCD === '20' ? 'row:source' : 'row:target'
}));
vi.mock('../sessaku-pieces/piece-key.js', () => ({
  acquireSessakuPieceLogicalLocks: vi.fn(), readSessakuPieceSets: vi.fn(async () => new Map()),
  encodeSessakuPieceKey: () => '', sessakuPieceKeyFromRow: () => ({})
}));
vi.mock('../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: vi.fn(async () => ({ grindingResourceCds: ['10'] })),
  normalizeProductionScheduleResourceCd: (resource: string) => resource,
  isProductionScheduleGrindingResourceCd: () => true
}));
vi.mock('../grinding-planning-board-resource-minutes.service.js', () => ({ getGrindingPlanningBoardResourceMinutes: mocks.legacy }));
vi.mock('../grinding-planning-board/schedule-source.js', () => ({ readScheduleSourceExcludedFseibans: vi.fn(async () => []) }));

import { updateGrindingPlanningBoardResourceOrder, updateGrindingPlanningBoardResourceOrderBulk } from '../grinding-planning-board/write.js';

const single = { siteKey: 'site', sourceRevision: 'r1', itemId: 'row:source', itemRevision: 'r1',
  targetItemId: 'row:target', targetItemRevision: 'r1', placement: 'before' as const };
const legacyReached = new Error('legacy projection reached');
beforeEach(() => {
  vi.clearAllMocks();
  // There is a live test on another machine, but none on the reordered machine.
  mocks.count.mockImplementation(async ({ where }) => where.resourceCd === '20' ? 1 : 0);
  mocks.transaction.mockImplementation(async (run) => run({ productionScheduleGrindingPlanningBoardTestBar: { count: mocks.count } }));
  mocks.legacy.mockRejectedValue(legacyReached);
  mocks.reorder.mockResolvedValue({ sourceRevision: 'r2', items: [] });
});

describe('resource order routing', () => {
  it('keeps the legacy single-item path for a machine without tests, using its override resource', async () => {
    await expect(updateGrindingPlanningBoardResourceOrder(single)).rejects.toBe(legacyReached);
    expect(mocks.count).toHaveBeenCalledWith({ where: expect.objectContaining({ siteKey: 'site', resourceCd: '10', deletedAt: null, completedAt: null }) });
    expect(mocks.legacy).toHaveBeenCalled();
    expect(mocks.reorder).not.toHaveBeenCalled();
  });
  it('keeps legacy bulk validation for a machine without tests', async () => {
    await expect(updateGrindingPlanningBoardResourceOrderBulk({ siteKey: 'site', sourceRevision: 'r1', resourceCd: '10', items: [] }))
      .rejects.toMatchObject({ code: 'INVALID_RESOURCE_ORDER_ITEMS' });
    expect(mocks.count).toHaveBeenCalledWith({ where: expect.objectContaining({ resourceCd: '10' }) });
    expect(mocks.reorder).not.toHaveBeenCalled();
  });
  it('routes a single-item reorder through the mixed lane when that machine has a live test', async () => {
    mocks.count.mockResolvedValue(1);
    await updateGrindingPlanningBoardResourceOrder(single);
    expect(mocks.reorder).toHaveBeenCalledWith(single);
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('routes bulk reorders through the mixed lane for the machine with a test', async () => {
    const params = { siteKey: 'site', sourceRevision: 'r1', resourceCd: '20', items: [{ itemId: 'row:source', itemRevision: 'r1' }] };
    await updateGrindingPlanningBoardResourceOrderBulk(params);
    expect(mocks.reorder).toHaveBeenCalledWith(params);
  });
  it.each(['itemId', 'targetItemId'] as const)('routes explicit single test %s without a lane lookup', async (field) => {
    const params = { ...single, [field]: 'test:id' };
    await updateGrindingPlanningBoardResourceOrder(params);
    expect(mocks.reorder).toHaveBeenCalledWith(params);
    expect(mocks.count).not.toHaveBeenCalled();
  });
  it('routes an explicit bulk test without a lane lookup', async () => {
    const params = { siteKey: 'site', sourceRevision: 'r1', resourceCd: '10', items: [{ itemId: 'test:id', itemRevision: 'r1' }] };
    await updateGrindingPlanningBoardResourceOrderBulk(params);
    expect(mocks.reorder).toHaveBeenCalledWith(params);
    expect(mocks.count).not.toHaveBeenCalled();
  });
});
