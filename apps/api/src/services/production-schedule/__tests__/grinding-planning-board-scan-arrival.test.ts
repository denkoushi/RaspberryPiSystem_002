import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const mocks = vi.hoisted(() => ({
  tx: {
    $transaction: vi.fn(),
    productionScheduleGrindingPlanningBoardArrival: { findFirst: vi.fn(), create: vi.fn() },
    productionScheduleGrindingPlanningBoardFirstProcessArrival: { upsert: vi.fn() }
  },
  lookup: vi.fn(), rows: vi.fn(), discover: vi.fn(), projection: vi.fn(), pieces: vi.fn(),
  pieceLocks: vi.fn(), stateLock: vi.fn(), parentLock: vi.fn(), ensureState: vi.fn(), enrich: vi.fn(), policy: vi.fn()
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.tx }));
vi.mock('../production-schedule-lookup.service.js', () => ({ listScheduleRowsByProductNo: mocks.lookup }));
vi.mock('../policies/resource-category-policy.service.js', async importOriginal => ({
  ...await importOriginal<typeof import('../policies/resource-category-policy.service.js')>(), getResourceCategoryPolicy: mocks.policy
}));
vi.mock('../grinding-planning-board/source.js', () => ({ readWinnerRowsByIds: mocks.rows }));
vi.mock('../grinding-planning-board/write-source.js', () => ({ discoverSourceRows: mocks.discover }));
vi.mock('../grinding-planning-board/write.js', () => ({ readLivePieceKeys: mocks.pieces, resolveCurrentProjectionInTransaction: mocks.projection }));
vi.mock('../grinding-planning-board/state.js', () => ({ ensurePlanningBoardState: mocks.ensureState, lockState: mocks.stateLock }));
vi.mock('../sessaku-pieces/piece-key.js', async importOriginal => ({
  ...await importOriginal<typeof import('../sessaku-pieces/piece-key.js')>(), acquireSessakuPieceLogicalLocks: mocks.pieceLocks
}));
vi.mock('../order-assignment/production-schedule-parent-row-lock.service.js', () => ({ acquireProductionScheduleParentRowLockInTransaction: mocks.parentLock }));
vi.mock('../process-arrival.service.js', () => ({ enrichRowsWithProcessArrival: mocks.enrich }));
import { applyGrindingPlanningBoardScanArrival } from '../grinding-planning-board/write-scan-arrival.js';
import { buildGrindingPlanningBoardRowItemId, projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { planningBoardArrivalDate } from '../grinding-planning-board/shared.js';

const input = { clientDevice: { name: 'scanner', siteKey: 'factory', location: 'other - scanner' }, manufacturingOrderBarcodeRaw: ' 12345 ' };
const row = (id: string, order: string, resource = 'G1') => ({ id, updatedAt: null, rowData: { FSEIBAN: 'S', FHINCD: 'PART', FSIGENCD: resource, FKOJUN: order, ProductNo: '12345' } });
const item = (id: string, order: string, completed = false, resource = 'G1') => ({
  itemId: id, sourceRowId: id, parentItemId: null, fseiban: 'S', fhincd: 'PART', productNo: '12345',
  processOrder: order, originalResourceCd: resource, isCompleted: completed
} as GrindingPlanningBoardItem);
const run = () => applyGrindingPlanningBoardScanArrival(input);
const arrival = mocks.tx.productionScheduleGrindingPlanningBoardArrival;
const first = mocks.tx.productionScheduleGrindingPlanningBoardFirstProcessArrival;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.tx.$transaction.mockImplementation(async callback => callback(mocks.tx));
  mocks.policy.mockResolvedValue({ grindingResourceCds: ['G1'], cuttingExcludedResourceCds: [] });
  mocks.lookup.mockResolvedValue([{ rowId: 'r', fsigencd: 'G1' }]);
  mocks.rows.mockResolvedValue([row('r', '020')]);
  mocks.discover.mockResolvedValue(new Map([['r', 'r']]));
  mocks.pieces.mockResolvedValue([]);
  mocks.projection.mockResolvedValue({ byItemId: new Map([['r', item('r', '020')]]) });
  mocks.enrich.mockResolvedValue([{ isFirstProcess: false }]);
  arrival.findFirst.mockResolvedValue(null);
});

describe('grinding arrival scans', () => {
  it('selects only the smallest incomplete grinding process under the manual-operation locks', async () => {
    mocks.pieces.mockResolvedValue([{ fseiban: 'S' }]);
    mocks.projection.mockResolvedValue({ byItemId: new Map([
      ['later', item('later', '30')], ['done', item('done', '10', true)],
      ['other', item('other', '1', false, 'CUT')], ['next', item('next', '20')]
    ]) });
    expect(await run()).toMatchObject({ resolutionStatus: 'RESOLVED', arrival: { itemId: 'next', siteKey: 'factory' } });
    expect(arrival.create).toHaveBeenCalledExactlyOnceWith({ data: {
      csvDashboardId: expect.any(String), siteKey: 'factory', itemKey: 'next',
      arrivalDate: new Date(`${planningBoardArrivalDate()}T00:00:00.000Z`)
    } });
    expect(mocks.lookup).toHaveBeenCalledWith('12345');
    expect(mocks.discover).toHaveBeenCalledWith([buildGrindingPlanningBoardRowItemId(row('r', '020').rowData)]);
    expect(mocks.projection).toHaveBeenCalledWith(expect.objectContaining({ allowPieceParent: true, itemIds: [] }));
    expect(mocks.pieceLocks.mock.invocationCallOrder[0]).toBeLessThan(mocks.stateLock.mock.invocationCallOrder[0]!);
    expect(mocks.stateLock.mock.invocationCallOrder[0]).toBeLessThan(mocks.parentLock.mock.invocationCallOrder[0]!);
    expect(mocks.parentLock.mock.invocationCallOrder[0]).toBeLessThan(mocks.projection.mock.invocationCallOrder[0]!);
    expect(first.upsert).not.toHaveBeenCalled();
  });

  it('ignores resources outside the site policy before resolving the board', async () => {
    mocks.lookup.mockResolvedValue([{ rowId: 'cut', fsigencd: 'CUT' }, { rowId: 'r', fsigencd: ' g1 ' }]);
    await run();
    expect(mocks.rows).toHaveBeenCalledWith(mocks.tx, ['r']);
    expect(mocks.policy).toHaveBeenCalledWith({ siteKey: 'factory' });
  });

  it('upserts first-process arrived, replacing excluded and refreshing recordedAt', async () => {
    mocks.enrich.mockResolvedValue([{ isFirstProcess: true }]);
    mocks.projection.mockResolvedValue({ byItemId: new Map([['r', { ...item('r', '10'), parentItemId: 'parent' }]]) });
    await run();
    expect(first.upsert).toHaveBeenCalledExactlyOnceWith({
      where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: expect.any(String), siteKey: 'factory', itemKey: 'parent' } },
      create: expect.objectContaining({ itemKey: 'parent', state: 'arrived', recordedAt: expect.any(Date) }),
      update: { state: 'arrived', recordedAt: expect.any(Date) }
    });
    expect(arrival.findFirst).not.toHaveBeenCalled();
    expect(arrival.create).not.toHaveBeenCalled();
  });

  it('does not create another arrival when an earlier date already exists', async () => {
    arrival.findFirst.mockResolvedValue({ arrivalDate: new Date('2020-01-01') });
    expect(await run()).toMatchObject({ resolutionStatus: 'RESOLVED' });
    expect(arrival.findFirst).toHaveBeenCalledWith({ where: { csvDashboardId: expect.any(String), siteKey: 'factory', itemKey: 'r' } });
    expect(arrival.create).not.toHaveBeenCalled();
  });

  it('repeated scans create only once', async () => {
    arrival.create.mockImplementation(async ({ data }) => { arrival.findFirst.mockResolvedValue(data); return data; });
    await run(); await run();
    expect(arrival.create).toHaveBeenCalledOnce();
  });

  it.each(['unknown', 'non-grinding', 'completed'])('returns UNRESOLVED for %s orders', async reason => {
    if (reason === 'unknown') mocks.lookup.mockResolvedValue([]);
    if (reason === 'non-grinding') mocks.lookup.mockResolvedValue([{ rowId: 'cut', fsigencd: 'CUT' }]);
    if (reason === 'completed') mocks.projection.mockResolvedValue({ byItemId: new Map([['r', item('r', '10', true)]]) });
    expect(await run()).toMatchObject({ resolutionStatus: 'UNRESOLVED', arrival: { reason: 'NO_INCOMPLETE_GRINDING_PROCESS' } });
    expect(arrival.create).not.toHaveBeenCalled(); expect(first.upsert).not.toHaveBeenCalled();
  });

  it.each([null, '', 'shared', 'default', ' shared '])('rejects unassigned factory site %j with 400', async siteKey => {
    await expect(applyGrindingPlanningBoardScanArrival({ ...input, clientDevice: { name: 'scanner', location: 'factory - scanner', siteKey } }))
      .rejects.toMatchObject({ statusCode: 400, code: 'HAIZEN_SCAN_SITE_REQUIRED' });
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it.each(['manual', 'external'])('uses the board completion projection for %s completion', async source => {
    const rows = [row('done', '10'), row('next', '20')];
    const details = new Map(rows.map(r => [r.id, {
      updatedAt: null, rowNotes: [], orderSupplements: [],
      productionScheduleProgress: { isCompleted: r.id === 'done' && source === 'manual', updatedAt: new Date() },
      productionScheduleExternalCompletion: { isExternallyCompleted: r.id === 'done' && source === 'external', updatedAt: new Date() }
    }]));
    const projection = projectGrindingPlanningBoard({ rows, details, ranks: { rows: new Map() }, overrides: new Map(),
      seibanOrder: ['S'], category: 'grinding', isResourceInCategory: cd => cd === 'G1' });
    mocks.projection.mockResolvedValue({ byItemId: new Map(projection.allItems.map(i => [i.itemId, i])) });
    expect(await run()).toMatchObject({ resolutionStatus: 'RESOLVED', arrival: { itemId: buildGrindingPlanningBoardRowItemId(rows[1]!.rowData) } });
  });
});
