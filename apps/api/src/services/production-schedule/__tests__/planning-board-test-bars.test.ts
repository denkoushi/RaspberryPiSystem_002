import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrindingPlanningBoardBar, GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import type { ProductionScheduleGrindingPlanningBoardTestBar } from '@prisma/client';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), current: vi.fn(), save: vi.fn(), project: vi.fn(),
  table: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  state: { findUniqueOrThrow: vi.fn(), update: vi.fn() } }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: {
  $transaction: mocks.transaction, productionScheduleGrindingPlanningBoardState: mocks.state,
  productionScheduleSessakuPieceSet: { findMany: async () => [] }
} }));
vi.mock('../grinding-planning-board/state.js', () => ({
  ensurePlanningBoardState: vi.fn(), lockState: async () => ({ id: 'board', seibanOrder: ['lot'] }),
  assertBoardRevision: vi.fn(), stateOrder: () => ['lot'], boardRevision: () => 'r2'
}));
vi.mock('../grinding-planning-board/source.js', () => ({ readWinnerRowsByFseibans: async () => [], readOverrides: async () => new Map() }));
vi.mock('../grinding-planning-board/write.js', () => ({
  resolveCurrentProjectionInTransaction: mocks.current, writeOverrideIfChanged: mocks.save, projectCurrentItems: mocks.project
}));
vi.mock('../grinding-planning-board/shared.js', () => ({ assertItemRevision: vi.fn(), isCategoryResource: () => true }));
vi.mock('../policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: async () => ({}), normalizeProductionScheduleResourceCd: (cd: string) => cd }));
vi.mock('../sessaku-pieces/piece-key.js', () => ({ acquireSessakuPieceLogicalLocks: vi.fn() }));
vi.mock('../grinding-planning-board/schedule-source.js', async (original) => ({
  ...await original<typeof import('../grinding-planning-board/schedule-source.js')>(), readScheduleSourceExcludedFseibans: async () => []
}));
import { createPlanningTestBar, mixedPlanningLane, projectPlanningTestBar, reorderPlanningTestBarLane } from '../grinding-planning-board/test-bars.js';

const band = { kind: 'today' as const, expiresAt: '2026-11-12T00:00:00.000Z' };
const normal = (itemId: string, alternateRank: number, specialDue: GrindingPlanningBoardItem['specialDue'] = null) => ({
  kind: 'row', itemId, itemRevision: itemId, fseiban: 'lot', effectiveResourceCd: '761', originalResourceCd: '761',
  isCompleted: false, alternateRank, specialDue
} as GrindingPlanningBoardItem);
let items: GrindingPlanningBoardItem[];
let rows: ProductionScheduleGrindingPlanningBoardTestBar[];
let overrides: Map<string, { alternateRank: number }>;
const ref = (itemId: string) => ({ itemId, itemRevision: itemId });
const lane = () => mixedPlanningLane(items.map((item) => ({ ...item, alternateRank: overrides.get(item.itemId)?.alternateRank ?? item.alternateRank })), rows.map(projectPlanningTestBar), ['lot'], '761');
const request = { siteKey: 'site', sourceRevision: 'r1' };

beforeEach(() => {
  vi.clearAllMocks();
  items = [normal('a1', 1, band), normal('a2', 2, band), normal('n1', 1), normal('n2', 2), normal('n3', 3)];
  rows = []; overrides = new Map();
  mocks.state.findUniqueOrThrow.mockResolvedValue({}); mocks.state.update.mockResolvedValue({});
  mocks.table.findMany.mockImplementation(async () => rows);
  mocks.table.create.mockImplementation(async ({ data }) => { const row = { ...data, id: 'uuid', version: 1, completedAt: null, deletedAt: null }; rows.push(row); return row; });
  mocks.table.update.mockImplementation(async ({ where, data }) => { const row = rows.find((row) => row.id === where.id)!; Object.assign(row, { ...data, version: row.version + 1 }); return row; });
  mocks.table.findUniqueOrThrow.mockImplementation(async () => rows[0]);
  mocks.transaction.mockImplementation(async (run) => run({ productionScheduleGrindingPlanningBoardTestBar: mocks.table, productionScheduleGrindingPlanningBoardState: mocks.state }));
  mocks.current.mockImplementation(async () => ({ state: { id: 'board' }, byItemId: new Map(items.map((item) => [item.itemId, item])), overrides, masterResourceCds: new Set(['761']) }));
  mocks.save.mockImplementation(async (_tx, _site, _id, _previous, data) => data);
  mocks.project.mockImplementation(() => new Map(items.map((item) => [item.itemId, item])));
});
const ids = (lane: GrindingPlanningBoardBar[]) => lane.map((item) => item.itemId);
const expectBands = () => {
  expect(ids(lane()).slice(0, 2)).toEqual(['a1', 'a2']);
  expect(lane().map((item) => item.alternateRank)).toEqual([1, 2, 1, 2, 3, 4]);
};

describe('test bar special due bands', () => {
  it.each([undefined, 'a1', 'n1'])('creates within the unbanded lane after %s and preserves per-band ranks', async (after) => {
    await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30, ...(after ? { afterItem: ref(after) } : {}) });
    expectBands();
    expect(ids(lane())).toEqual(['a1', 'a2', ...(after === 'n1' ? ['n1', 'test:uuid'] : ['test:uuid', 'n1']), 'n2', 'n3']);
  });
  it.each(['single', 'bulk'] as const)('reorders within the unbanded lane using %s and keeps the priority band first', async (mode) => {
    await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 });
    const test = projectPlanningTestBar(rows[0]);
    await reorderPlanningTestBarLane(mode === 'single'
      ? { ...request, ...ref(test.itemId), itemRevision: test.itemRevision, targetItemId: 'n2', targetItemRevision: 'n2', placement: 'after' }
      : { ...request, resourceCd: '761', items: [ref('a1'), ref('a2'), ref('n1'), ref('n2'), { itemId: test.itemId, itemRevision: test.itemRevision }, ref('n3')] });
    expectBands();
    expect(ids(lane())).toEqual(['a1', 'a2', 'n1', 'n2', 'test:uuid', 'n3']);
  });
  it.each(['test-to-band', 'band-to-test', 'bulk'] as const)('rejects crossing the priority band (%s)', async (mode) => {
    await createPlanningTestBar({ ...request, resourceCd: '761', minutes: 30 });
    const test = projectPlanningTestBar(rows[0]); mocks.save.mockClear(); mocks.table.update.mockClear();
    const testRef = { itemId: test.itemId, itemRevision: test.itemRevision };
    const source = mode === 'band-to-test' ? ref('a1') : testRef;
    const target = mode === 'band-to-test' ? testRef : ref('a1');
    await expect(reorderPlanningTestBarLane(mode === 'bulk'
      ? { ...request, resourceCd: '761', items: [ref('a1'), testRef, ref('a2'), ref('n1'), ref('n2'), ref('n3')] }
      : { ...request, ...source, targetItemId: target.itemId, targetItemRevision: target.itemRevision, placement: 'before' }))
      .rejects.toMatchObject({ code: 'SPECIAL_DUE_ORDER_BAND_MISMATCH' });
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.table.update).not.toHaveBeenCalled();
  });
});
