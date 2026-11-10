import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
const mocks = vi.hoisted(() => ({ split: vi.fn(), items: [] as GrindingPlanningBoardItem[], query: vi.fn(),
  transaction: vi.fn(), tryLock: vi.fn(), timeout: vi.fn(), state: vi.fn(), ensureState: vi.fn(), policy: vi.fn(), capacity: vi.fn(), details: vi.fn(), overrides: vi.fn(), ranks: vi.fn(), warn: vi.fn(), sets: vi.fn(), history: vi.fn(), projection: vi.fn(), rows: vi.fn(), mark: vi.fn(), audit: vi.fn(), callLog: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: {
  $transaction: mocks.transaction,
  $queryRaw: mocks.query,
  productionScheduleGrindingPlanningBoardState: { findUniqueOrThrow: mocks.state },
  productionScheduleSessakuPieceHistory: { findMany: mocks.history, createMany: mocks.mark },
  productionScheduleSessakuPieceSet: { findMany: mocks.sets }
} }));
vi.mock('../../../../lib/logger.js', () => ({ logger: { warn: mocks.warn, info: vi.fn(), child: () => ({ info: mocks.callLog }) } }));
vi.mock('../../grinding-planning-board/state.js', () => ({ ensurePlanningBoardState: mocks.ensureState, stateOrder: () => ['S'] }));
vi.mock('../../grinding-planning-board/source.js', () => ({ readWinnerRowsByFseibans: mocks.rows, readRowDetails: mocks.details,
  readOverrides: mocks.overrides, readRanks: mocks.ranks }));
vi.mock('../piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../piece-key.js')>(), readSessakuPieceSets: mocks.sets }));
vi.mock('../../grinding-planning-board-projection.js', () => ({ projectGrindingPlanningBoard: mocks.projection, buildGrindingPlanningBoardRowItemId: vi.fn() }));
vi.mock('../../grinding-planning-board-resource-capacity.service.js', () => ({ getGrindingPlanningBoardResourceCapacity: mocks.capacity }));
vi.mock('../../policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: mocks.policy, isProductionScheduleCuttingResourceCd: (cd: string) => cd !== '305' }));
vi.mock('../sessaku-pieces.service.js', () => ({ splitSessakuPieces: mocks.split,
  runAutoUnitSplitBatch: async (_tx: unknown, _ids: unknown, work: () => Promise<unknown>) => work(),
  runAutoUnitSplitLot: async (work: () => Promise<unknown>) => work() }));
vi.mock('../piece-audit.js', async () => ({ runSessakuPieceOperation: mocks.audit,
  pieceTimingStage: new (await import('node:async_hooks')).AsyncLocalStorage() }));
import { autoSplitSessakuUnits, autoUnitSplitCandidates, AUTO_UNIT_SPLIT_MAX_LOTS,
  AUTO_UNIT_SPLIT_BUDGET_MS, AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS, AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS,
  AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS } from '../auto-unit-split.service.js';
import { Prisma } from '@prisma/client';
import { sessakuPieceConflict, sessakuPieceParentItemId } from '../piece-key.js';
import { ApiError } from '../../../../lib/errors.js';

const item = (patch: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'row:one', kind: 'row', fseiban: 'S', fhincd: 'PART', processOrder: '10', originalResourceCd: '021', effectiveResourceCd: '021',
  plannedQuantity: 3, itemRevision: 'a'.repeat(64), isCompleted: false, sourceRowId: 'source', ...patch
} as GrindingPlanningBoardItem);
const sqlExcludedParents = (sql: { values: unknown[] }) => new Set(sql.values.filter(Array.isArray).flat()
  .filter((value): value is string => typeof value === 'string' && value.startsWith('row:')));
const candidatePageSize = AUTO_UNIT_SPLIT_MAX_LOTS + 1;
const capacity = { dailyHoursByResource: {}, runsThroughBreaksResources: [] };
const candidates = (items: GrindingPlanningBoardItem[]) => autoUnitSplitCandidates(items, capacity, (cd) => cd !== '305');

describe('automatic unit split', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true'); mocks.items = [];
    mocks.audit.mockImplementation(async (audit, callback) => await callback(audit) ?? { pieceSetVersion: 1 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: (sql: { sql?: string } | TemplateStringsArray, ...values: unknown[]) => Array.isArray(sql)
        ? sql.join('').includes('pg_blocking_pids') ? Promise.resolve([{ waiting: false }]) : sql.join('').includes('set_config') ? mocks.timeout(sql, ...values) : mocks.tryLock(sql, ...values)
        : mocks.query(sql),
      productionScheduleGrindingPlanningBoardState: { findUniqueOrThrow: mocks.state },
      productionScheduleSessakuPieceSet: { findMany: mocks.sets },
      productionScheduleSessakuPieceHistory: { findMany: mocks.history }
    }));
    mocks.state.mockResolvedValue({ seibanOrder: ['S'] });
    mocks.policy.mockResolvedValue({ grindingResourceCds: ['305'], cuttingExcludedResourceCds: [] });
    mocks.capacity.mockResolvedValue({}); mocks.details.mockResolvedValue(new Map());
    mocks.overrides.mockResolvedValue(new Map()); mocks.ranks.mockResolvedValue({ rows: new Map() });
    vi.spyOn(performance, 'now').mockReturnValue(0);
    mocks.tryLock.mockResolvedValue([{ acquired: true }]); mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S' }]);
    mocks.sets.mockResolvedValue(new Map()); mocks.history.mockResolvedValue([]); mocks.rows.mockResolvedValue([]);
    mocks.projection.mockImplementation(() => ({ items: mocks.items }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it.each([2, 50])('accepts the default enabled resources and quantity %s', (plannedQuantity) => {
    expect(candidates([item({ plannedQuantity })])).toHaveLength(1);
    expect(candidates([item({ effectiveResourceCd: '022', plannedQuantity })])).toHaveLength(1);
  });
  it.each([
    { originalResourceCd: '305' }, { effectiveResourceCd: '305' }, { fseiban: '********' }, { fseiban: ' ******** ' },
    { fseiban: '' }, { fhincd: '' }, { processOrder: '' }, { isCompleted: true }, { isLaterProcess: true },
    { quantityWarning: 'INVALID_PLANNED_QUANTITY' }, { quantityWarning: 'COMPLETED_QUANTITY_EXCEEDS_PLAN' },
    { plannedQuantity: null }, { plannedQuantity: 1 }, { plannedQuantity: 51 }, { plannedQuantity: 2.5 }, { plannedQuantity: NaN },
    { kind: 'piece', sourcePieceId: 'source' }
  ] as Partial<GrindingPlanningBoardItem>[])('excludes ineligible lots %j', (patch) => {
    expect(candidates([item(patch)])).toHaveLength(0);
  });
  it('excludes an expanded parent by child parent IDs while accepting an empty manual set', () => {
    const parent = item({ pieceSetVersion: 1 });
    const piece = item({ itemId: 'piece:unit', kind: 'piece', parentItemId: parent.itemId, pieceSetVersion: 1, plannedQuantity: 1 });
    expect(candidates([parent, piece])).toEqual([]);
    expect(candidates([parent])).toEqual([parent]);
  });
  it('uses effective resource overrides and explicit resource flags', () => {
    const settings = { ...capacity, unitSplitEnabledByResource: { '021': false, '999': true } };
    expect(autoUnitSplitCandidates([item()], settings, () => true)).toHaveLength(0);
    expect(autoUnitSplitCandidates([item({ originalResourceCd: '022', effectiveResourceCd: '999' })], settings, () => true)).toHaveLength(1);
    expect(candidates([item({ originalResourceCd: '999', effectiveResourceCd: '021' })])).toHaveLength(1);
  });
  it('excludes later rows even when they have no PieceSet yet', () => {
    const first = item({ processOrder: '010' });
    const second = item({ itemId: 'later', processOrder: '20' });
    expect(candidates([second, first])).toEqual([first]);
    expect(candidates([first, item({ itemId: 'same-order', processOrder: '10' })])).toHaveLength(2);
  });
  it('passes unit quantities and authenticated audit through the existing split, then does nothing on a second call', async () => {
    mocks.items = [item()];
    mocks.split.mockImplementation(async () => { mocks.items = [item({ kind: 'piece', parentItemId: 'row:one', pieceId: 'unit', plannedQuantity: 1, pieceSetVersion: 1 })]; });
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledWith(expect.objectContaining({ siteKey: 'site', expectedPieceSetVersion: 0,
      quantities: [1, 1, 1], autoUnitSplit: true, audit: expect.objectContaining({ action: 'auto_unit_split_lot' }) }));
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(1);
  });
  it('includes waiter probe count and time in the completed call log', async () => {
    mocks.items = [item()];
    mocks.split.mockResolvedValue({});
    await autoSplitSessakuUnits({ siteKey: 'site' });
    expect(mocks.callLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'sessaku_piece.auto_unit_split_call', yieldCheckCount: 2, yieldCheckMs: 0
    }), expect.any(String));
  });
  it('continues after a structural per-lot 409 and bounds the number of attempted transactions', async () => {
    mocks.items = Array.from({ length: 6 }, (_, i) => item({ itemId: `row:${Buffer.from(JSON.stringify(['S', `PART-${i}`, '021', '10'])).toString('base64url')}`, fhincd: `PART-${i}` }));
    expect(AUTO_UNIT_SPLIT_MAX_LOTS).toBe(3);
    mocks.split.mockRejectedValueOnce(new ApiError(409, 'later completed', undefined, 'LATER_PROCESS_PIECE_COMPLETED')).mockResolvedValue({});
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: AUTO_UNIT_SPLIT_MAX_LOTS, skippedCount: 1, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(AUTO_UNIT_SPLIT_MAX_LOTS + 1);
  });
  it('returns the second caller immediately while the first runner is still splitting', async () => {
    mocks.items = [item()];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    mocks.tryLock.mockResolvedValueOnce([{ acquired: true }]).mockResolvedValueOnce([{ acquired: false }]);
    mocks.split.mockReturnValue(pending);
    const first = autoSplitSessakuUnits({ siteKey: 'site' });
    await vi.waitFor(() => expect(mocks.split).toHaveBeenCalledTimes(1));
    try {
      expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
      expect(mocks.rows).toHaveBeenCalledTimes(1);
    } finally { release(); await first; }
  });
  it('returns without loading winners or projecting when no untouched cutting key exists', async () => {
    mocks.query.mockResolvedValue([]);
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.rows).not.toHaveBeenCalled(); expect(mocks.projection).not.toHaveBeenCalled();
    expect(mocks.sets).not.toHaveBeenCalled(); expect(mocks.audit.mock.calls.filter(([audit]) => audit.action === 'auto_unit_split_lot')).toHaveLength(0);
  });
  it.each([new ApiError(500, 'timeout')])(
    'stops and rethrows server ApiErrors', async (error) => {
      mocks.items = [item(), item({ itemId: 'row:two' })]; mocks.split.mockRejectedValueOnce(error);
      await expect(autoSplitSessakuUnits({ siteKey: 'site' })).rejects.toBe(error);
      expect(mocks.split).toHaveBeenCalledTimes(1);
    });
  it('does not cache a P2028 lot failure or continue using the expired runner', async () => {
    mocks.items = [item(), item({ itemId: 'row:two', fhincd: 'TWO' })];
    mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S', parentId: 'row:one', inputVersion: 'runner-v1' }]);
    mocks.split.mockRejectedValueOnce(Object.assign(new Error('expired transaction'), { code: 'P2028' }));
    expect(await autoSplitSessakuUnits({ siteKey: 'expired-lot-runner' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(1);
    expect(mocks.warn).not.toHaveBeenCalled();
    await autoSplitSessakuUnits({ siteKey: 'expired-lot-runner' });
    expect(mocks.query.mock.calls[1][0].sql).not.toContain('JSONB_TO_RECORDSET');
  });
  it('skips and remembers an unexpected P2025 while continuing to the next lot', async () => {
    mocks.items = [item(), item({ itemId: 'row:tail', sourceRowId: 'tail', fhincd: 'TAIL' })];
    mocks.query.mockResolvedValueOnce(mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId, inputVersion: 'p2025-v1' })))
      .mockResolvedValueOnce([]);
    mocks.split.mockRejectedValueOnce(Object.assign(new Error('missing record'), { code: 'P2025' }));
    expect(await autoSplitSessakuUnits({ siteKey: 'unexpected-lot' })).toEqual({ splitCount: 1, skippedCount: 1, hasMore: false });
    expect(mocks.split.mock.calls[1][0].parentItemId).toBe('row:tail');
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'sessaku_piece.auto_unit_split_skipped', code: 'P2025' }), expect.any(String));
    await autoSplitSessakuUnits({ siteKey: 'unexpected-lot' });
    expect(mocks.query.mock.calls[1][0].values).toContainEqual(expect.stringContaining('p2025-v1'));
  });
  it('remembers only the second consecutive STALE for the same inputVersion, including P2002', async () => {
    mocks.items = [item()];
    const row = { id: 'source', fseiban: 'S', parentId: 'row:one', inputVersion: 'v1' };
    mocks.query.mockImplementation(async (sql) => {
      const cached = sql.values.filter((value: unknown) => typeof value === 'string' && value.startsWith('[{'))
        .flatMap((value: string) => JSON.parse(value)) as { parentId: string; inputVersion: string }[];
      return cached.some((entry) => entry.parentId === row.parentId && entry.inputVersion === row.inputVersion) ? [] : [row];
    });
    mocks.split.mockImplementation(async () => sessakuPieceConflict(new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' })));
    const siteKey = 'repeated-stale';
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: true });
    row.inputVersion = 'v2';
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: true });
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(mocks.query.mock.calls[2][0].sql).not.toContain('JSONB_TO_RECORDSET');
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(3);
  });
  it('rolls back the whole lot when its remaining piece fails', async () => {
    mocks.items = ['a', 'b'].map((pieceId) => item({ itemId: `piece:${pieceId}`, kind: 'piece', parentItemId: 'row:one', pieceId, pieceSetVersion: 1 }));
    mocks.split.mockResolvedValueOnce({ pieceSetVersion: 2 })
      .mockRejectedValueOnce(new ApiError(409, 'stale', undefined, 'STALE_SESSAKU_PIECES'));
    expect(await autoSplitSessakuUnits({ siteKey: 'partial-lot' })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(2);
  });
  it('splits history-only lots without reading or writing history', async () => {
    const key = { fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10' };
    const id = `row:${Buffer.from(JSON.stringify(Object.values(key))).toString('base64url')}`;
    mocks.items = [item({ itemId: id }), item({ isCompleted: true }), item({ originalResourceCd: '305' })];
    mocks.history.mockResolvedValue([key]);
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each([true, false])('does not recount touched siblings outside SQL candidates (has candidate=%s)', async (hasCandidate) => {
    const key = { fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10' };
    mocks.items = [item({ itemId: sessakuPieceParentItemId(key), sourceRowId: 'touched' }),
      item({ itemId: 'row:two', sourceRowId: 'source', fhincd: 'OTHER', isCompleted: !hasCandidate })];
    mocks.history.mockResolvedValue([key]);
    for (let call = 0; call < 2; call++) {
      expect(await autoSplitSessakuUnits({ siteKey: 'siblings' })).toEqual({ splitCount: hasCandidate ? 1 : 0, skippedCount: 0, hasMore: false });
    }
  });
  it.each([Object.assign(new Error('serialization'), { code: 'P2034' })])(
    'counts transient conflicts and returns hasMore without a permanent marker', async (error) => {
      mocks.items = [item()]; mocks.split.mockRejectedValueOnce(error);
      expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: true });
      expect(mocks.mark).not.toHaveBeenCalled();
    });
  it('does not count SQL-capped lots from the same seiban as skipped', async () => {
    mocks.items = Array.from({ length: 7 }, (_, i) => item({ itemId: `row:${i}`, fhincd: `PART-${i}`, sourceRowId: `source-${i}` }));
    mocks.query.mockResolvedValue(mocks.items.slice(0, candidatePageSize).map((item) => ({ id: item.sourceRowId, fseiban: 'S' })));
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: AUTO_UNIT_SPLIT_MAX_LOTS, skippedCount: 0, hasMore: true });
  });
  it('does not persist structural rejections as history', async () => {
    mocks.items = [item()];
    mocks.split.mockRejectedValue(new ApiError(409, 'later completed', undefined, 'LATER_PROCESS_PIECE_COMPLETED'));
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each(['completed', 'quantity-warning', 'row-completed', 'operation'] as const)(
    'matches the SQL gate for a linked downstream %s before opening a lot transaction', async (protection) => {
      const source = { id: 'source-set', fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10',
        pieces: [{ id: 'editable', quantity: 3, isCompleted: false }] };
      const parentId = sessakuPieceParentItemId(source);
      const later = { ...source, id: 'later-set', fsigencd: '305', fkojun: '20', sourcePieceSetId: source.id,
        quantityWarning: protection === 'quantity-warning' ? 'INVALID_PLANNED_QUANTITY' : null,
        pieces: [{ id: 'later-piece', sourcePieceId: 'editable', isCompleted: protection === 'completed',
          opCompletions: protection === 'operation' ? [{ opNo: 9 }] : [] }] };
      mocks.sets.mockResolvedValue(new Map([['source', source], ['later', later]]));
      mocks.items = [item({ itemId: 'piece:editable', kind: 'piece', parentItemId: parentId, pieceId: 'editable', pieceSetVersion: 1 }),
        item({ itemId: 'piece:later-piece', kind: 'piece', parentItemId: sessakuPieceParentItemId(later), pieceId: 'later-piece',
          sourcePieceId: 'editable', isCompleted: protection === 'row-completed' })];
      expect(await autoSplitSessakuUnits({ siteKey: 'sql-ts-downstream' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
      expect(mocks.split).not.toHaveBeenCalled();
    });
  it('splits both remaining pieces using the version returned by its own preceding split', async () => {
    mocks.items = [item({ itemId: 'piece:a', parentItemId: 'row:one', kind: 'piece', pieceId: 'a', pieceSetVersion: 7, plannedQuantity: 2 }),
      item({ itemId: 'piece:b', parentItemId: 'row:one', kind: 'piece', pieceId: 'b', pieceSetVersion: 7, plannedQuantity: 3 })];
    mocks.split.mockResolvedValueOnce({ pieceSetVersion: 8 }).mockResolvedValueOnce({ pieceSetVersion: 9 });
    expect(await autoSplitSessakuUnits({ siteKey: 'resplit' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.split.mock.calls.map(([params]) => [params.parentItemId, params.targetPieceId, params.expectedPieceSetVersion, params.quantities]))
      .toEqual([['row:one', 'a', 7, [1, 1]], ['row:one', 'b', 8, [1, 1, 1]]]);
  });
  it.each(['STALE_SESSAKU_PIECES', 'AUTO_UNIT_SPLIT_ALREADY_TOUCHED', 'AUTO_UNIT_SPLIT_INELIGIBLE', 'PIECE_QUANTITY_CONFLICT', 'P2034'])(
    'continues to the next lot after %s', async (code) => {
      mocks.items = [item(), item({ itemId: 'row:two', fhincd: 'OTHER' })];
      mocks.split.mockRejectedValueOnce(code === 'P2034' ? Object.assign(new Error('serialization'), { code }) : new ApiError(409, 'changed', undefined, code));
      expect(await autoSplitSessakuUnits({ siteKey: 'continue' })).toEqual({ splitCount: 1, skippedCount: 1,
        hasMore: code === 'P2034' || code === 'STALE_SESSAKU_PIECES' });
      expect(mocks.split).toHaveBeenCalledTimes(2); expect(mocks.mark).not.toHaveBeenCalled();
    });
  it.each(['AUTO_UNIT_SPLIT_BUSY', 'AUTO_UNIT_SPLIT_BUDGET'])('stops the lot loop on %s', async (code) => {
    mocks.items = [item(), item({ itemId: 'row:two', fhincd: 'OTHER' })];
    mocks.split.mockRejectedValueOnce(new ApiError(409, 'retry', undefined, code));
    expect(await autoSplitSessakuUnits({ siteKey: 'busy' })).toEqual({ splitCount: 0, skippedCount: code === 'AUTO_UNIT_SPLIT_BUSY' ? 0 : 1, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(1);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each(['AUTO_UNIT_SPLIT_ALREADY_TOUCHED', 'AUTO_UNIT_SPLIT_INELIGIBLE'])('does not request another call solely for %s', async (code) => {
    mocks.items = [item()];
    mocks.split.mockRejectedValueOnce(new ApiError(409, 'changed', undefined, code));
    expect(await autoSplitSessakuUnits({ siteKey: `no-retry-${code}` })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each(['OFF→ON', 'quantity 2→1→2'])('does not cache temporary ineligibility after %s with unchanged logical keys', async (change) => {
    mocks.items = [item({ plannedQuantity: 2 })];
    let enabled = true;
    let quantity = 2;
    const siteKey = `temporary-${change}`;
    mocks.query.mockImplementation(async () => {
      return enabled && quantity >= 2 ? [{ id: 'source', fseiban: 'S', parentId: 'row:one' }] : [];
    });
    // The setting/quantity changes after discovery but before the locked recheck.
    mocks.split.mockImplementationOnce(async () => {
      if (change === 'OFF→ON') enabled = false;
      else quantity = 1;
      throw new ApiError(409, 'temporarily ineligible', undefined, 'AUTO_UNIT_SPLIT_INELIGIBLE');
    }).mockResolvedValue({});
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(1);
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    enabled = true; quantity = 2;
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(2);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 409, 422, 429])('skips an unexpected %s with a warning and continues without requesting retry', async (statusCode) => {
    mocks.items = [item(), item({ itemId: 'row:two', fhincd: 'OTHER' })];
    mocks.split.mockRejectedValueOnce(new ApiError(statusCode, 'rejected')).mockResolvedValue({});
    expect(await autoSplitSessakuUnits({ siteKey: `http-${statusCode}` })).toEqual({ splitCount: 1, skippedCount: 1, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(2);
    expect(mocks.warn).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      event: 'sessaku_piece.auto_unit_split_skipped', parentItemId: 'row:one', statusCode
    }), expect.any(String));
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each([400, 409])('remembers a persistent locked quantity conflict with status %s', async (statusCode) => {
    mocks.items = [item()];
    // CSV quantity changes are rebuilt under the lock; this represents a persistent quantity warning.
    mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S', parentId: 'row:one', inputVersion: 'quantity-warning' }]);
    mocks.split.mockRejectedValueOnce(new ApiError(statusCode, 'quantity warning', undefined, 'PIECE_QUANTITY_CONFLICT'));
    expect(await autoSplitSessakuUnits({ siteKey: `quantity-${statusCode}` })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(1);
    mocks.query.mockResolvedValueOnce([]);
    await autoSplitSessakuUnits({ siteKey: `quantity-${statusCode}` });
    expect(mocks.query.mock.calls[1][0].values).toContainEqual(expect.stringContaining('quantity-warning'));
  });
  it.each(['lock', 'ensureState', 'state', 'policy', 'candidate', 'winners', 'parallel', 'projection'])(
    'stops preprocessing immediately after %s exhausts the runner deadline', async (stage) => {
      const now = vi.mocked(performance.now).mockReturnValue(0);
      const expire = () => now.mockReturnValue(AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS - AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS);
      mocks.items = [item()];
      const stages = [mocks.tryLock, mocks.ensureState, mocks.state, mocks.policy, mocks.query, mocks.rows, mocks.details, mocks.projection];
      switch (stage) {
        case 'lock': mocks.tryLock.mockImplementationOnce(async () => { expire(); return [{ acquired: true }]; }); break;
        case 'ensureState': mocks.ensureState.mockImplementationOnce(async () => { expire(); }); break;
        case 'state': mocks.state.mockImplementationOnce(async () => { expire(); return { seibanOrder: ['S'] }; }); break;
        case 'policy': mocks.policy.mockImplementationOnce(async () => { expire(); return {}; }); break;
        case 'candidate': mocks.query.mockImplementationOnce(async () => { expire(); return []; }); break;
        case 'winners': mocks.rows.mockImplementationOnce(async () => { expire(); return []; }); break;
        case 'parallel': mocks.details.mockImplementationOnce(async () => { expire(); return new Map(); }); break;
        case 'projection': mocks.projection.mockImplementationOnce(() => { expire(); return { items: mocks.items }; }); break;
      }
      expect(await autoSplitSessakuUnits({ siteKey: `preprocessing-${stage}` })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
      const nextIndex = { lock: 1, ensureState: 2, state: 3, policy: 4, candidate: 5, winners: 6, parallel: 7, projection: 8 }[stage]!;
      for (const fn of stages.slice(nextIndex)) expect(fn).not.toHaveBeenCalled();
      expect(mocks.audit.mock.calls.filter(([audit]) => audit.action === 'auto_unit_split_lot')).toHaveLength(0); expect(mocks.split).not.toHaveBeenCalled();
      // The next request must re-evaluate, even after an empty SQL result.
      now.mockReturnValue(AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS);
      mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S' }]);
      expect(await autoSplitSessakuUnits({ siteKey: `preprocessing-${stage}` })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    });
  it('bounds preprocessing statement timeouts by the remaining runner budget on the runner connection', async () => {
    const now = vi.mocked(performance.now).mockReturnValue(0);
    mocks.items = [item()];
    mocks.rows.mockImplementation(async () => { now.mockReturnValue(8500); return []; });
    await autoSplitSessakuUnits({ siteKey: 'statement-timeout' });
    expect(mocks.timeout.mock.calls.map(([, value]) => value)).toEqual(['9000ms', '9000ms', '9000ms', '9000ms', '500ms', '500ms', '500ms', '500ms']);
    expect(mocks.rows.mock.calls[0][0]).toEqual(expect.objectContaining({ $queryRaw: expect.any(Function) }));
    expect(mocks.rows.mock.calls[0][0].$queryRaw).not.toBe(mocks.query);
    for (const [index, read] of [mocks.rows, mocks.sets, mocks.details, mocks.overrides, mocks.ranks].entries()) {
      expect(read.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.timeout.mock.invocationCallOrder[index + 3]);
    }
  });
  it('warns and retains a retry after a candidate statement timeout, then splits the tail', async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error('statement timeout'), { code: 'P2010', meta: { code: '57014' } }));
    expect(await autoSplitSessakuUnits({ siteKey: 'statement-cancelled' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'sessaku_piece.auto_unit_split_candidate_timeout' }), expect.any(String));
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.rows).not.toHaveBeenCalled(); expect(mocks.split).not.toHaveBeenCalled();
    mocks.items = [item({ itemId: 'row:tail', fhincd: 'TAIL' })];
    expect(await autoSplitSessakuUnits({ siteKey: 'statement-cancelled' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ parentItemId: 'row:tail' }));
  });
  it.each([' PART', 'PART ', 'ＰＡＲＴ'])('excludes different raw part keys that cannot propagate: %j', (fhincd) => {
    expect(candidates([item(), item({ itemId: 'later', processOrder: '20', fhincd })])).toEqual([]);
  });
  it('uses separate request and lot audit actions and scopes key reads to candidate seibans', async () => {
    mocks.items = [item()];
    await autoSplitSessakuUnits({ siteKey: 'site' });
    expect(mocks.audit.mock.calls.map(([audit]) => audit.action)).toEqual(['auto_unit_split', 'auto_unit_split_lot']);
    expect(mocks.sets).toHaveBeenCalled(); expect(mocks.history).not.toHaveBeenCalled();
  });
  it('stops at the original wall-clock budget', async () => {
    mocks.items = [item(), item({ itemId: 'row:two' })];
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    mocks.split.mockImplementation(async () => { now.mockReturnValue(3001); });
    try {
      expect(await autoSplitSessakuUnits({ siteKey: 'budget' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: true });
      expect(mocks.split).toHaveBeenCalledTimes(1);
      expect(mocks.split).toHaveBeenCalledWith(expect.objectContaining({ deadline: 3000 }));
    } finally { now.mockRestore(); }
  });
  it.each(['P2028', 'P2024'])('returns retryable results when the outer runner fails with %s', async (code) => {
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('runner timeout'), { code }));
    expect(await autoSplitSessakuUnits({ siteKey: 'runner' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it('reports no committed lots when the shared transaction times out on exit', async () => {
    mocks.items = [item()];
    const transaction = mocks.transaction.getMockImplementation()!;
    mocks.transaction.mockImplementationOnce(async (callback) => {
      await transaction(callback);
      throw Object.assign(new Error('runner expired'), { code: 'P2028' });
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'runner-exit' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
  });
  it('queries candidates with the capped LIMIT on every request, including consecutive empty results', async () => {
    mocks.query.mockResolvedValue([]);
    for (const siteKey of ['site', 'site', 'other']) {
      expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    }
    expect(mocks.query).toHaveBeenCalledTimes(3);
    for (const [sql] of mocks.query.mock.calls) {
      expect(sql.sql).toContain('WITH splittable_rows');
      expect(sql.values.at(-1)).toBe(candidatePageSize);
    }
    mocks.items = [item()];
    mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S' }]);
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.query).toHaveBeenCalledTimes(4);
  });
  it.each(['projection', 'missing-projection', 'locked-ineligible', 'locked-structural'])('finishes after paging past a full page skipped by %s with no tail', async (stage) => {
    const keys = Array.from({ length: candidatePageSize }, (_, i) => ({ fseiban: 'S', fhincd: `PART-${i}`, fsigencd: '021', fkojun: '10' }));
    mocks.items = keys.map((key, i) => item({ itemId: sessakuPieceParentItemId(key), fhincd: key.fhincd, sourceRowId: `source-${i}`,
      plannedQuantity: stage === 'projection' ? 1 : 3 }));
    const sqlRows = mocks.items.map((item) => ({ id: item.sourceRowId, fseiban: 'S', parentId: item.itemId }));
    mocks.query.mockImplementation(async (sql) => sqlRows.filter((row) => !sqlExcludedParents(sql).has(row.parentId)));
    if (stage === 'missing-projection') mocks.items = [];
    const locked = stage.startsWith('locked');
    if (locked) mocks.split.mockRejectedValue(new ApiError(409, 'ineligible', undefined,
      stage === 'locked-structural' ? 'AUTO_UNIT_SPLIT_STRUCTURALLY_INELIGIBLE' : 'AUTO_UNIT_SPLIT_INELIGIBLE'));
    for (let call = 0; call < 2; call++) {
      expect(await autoSplitSessakuUnits({ siteKey: 'rejected-page' })).toEqual({ splitCount: 0,
        skippedCount: locked ? candidatePageSize : 0, hasMore: false });
    }
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.split).toHaveBeenCalledTimes(locked ? candidatePageSize * 2 : 0);
    expect(mocks.mark).not.toHaveBeenCalled();
    if (!locked) expect(mocks.audit.mock.calls.filter(([audit]) => audit.action === 'auto_unit_split_lot')).toHaveLength(0);
  });
  it.each(['later-process', 'part-variant'])('splits the tail in the same call after full pages of TS %s rejections', async (reason) => {
    const rejected = Array.from({ length: 12 }, (_, i) => item({ itemId: `row:rejected-${i}`, sourceRowId: `rejected-${i}`,
      fhincd: `PART-${i}`, processOrder: '10A' }));
    const predecessors = rejected.map((row) => ({ ...row, itemId: `earlier-${row.itemId}`, sourceRowId: `earlier-${row.sourceRowId}`,
      originalResourceCd: '305', effectiveResourceCd: '305', processOrder: '1',
      fhincd: reason === 'part-variant' ? ` ${row.fhincd} ` : row.fhincd }));
    const tail = item({ itemId: 'row:tail', sourceRowId: 'tail', fhincd: 'TAIL' });
    mocks.items = [...rejected, ...predecessors, tail];
    const sqlRows = [...rejected, tail].map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId }));
    mocks.query.mockImplementation(async (sql) => sqlRows.filter((row) => !sqlExcludedParents(sql).has(row.parentId)).slice(0, candidatePageSize));
    // A subsequent opening sees the successful lot removed, rather than retrying an empty first page forever.
    mocks.split.mockImplementation(async () => { sqlRows.pop(); });
    expect(await autoSplitSessakuUnits({ siteKey: 'paged' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.query).toHaveBeenCalledTimes(Math.ceil((rejected.length + 1) / candidatePageSize));
    expect(mocks.split).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ parentItemId: tail.itemId }));
    expect(await autoSplitSessakuUnits({ siteKey: 'paged' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(1);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each(['projection', 'locked'])('passes more than 50 permanent %s rejections to split a normal tail', async (stage) => {
    const rejected = Array.from({ length: 66 }, (_, i) => item({ itemId: `row:${i}`, sourceRowId: `source-${i}`,
      fhincd: `PART-${i}`, plannedQuantity: stage === 'projection' ? 1 : 3 }));
    const tail = item({ itemId: 'row:tail', sourceRowId: 'tail', fhincd: 'TAIL' });
    mocks.items = [...rejected, tail];
    const sqlRows = mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId }));
    mocks.query.mockImplementation(async (sql) => sqlRows.filter((row) => !sqlExcludedParents(sql).has(row.parentId)).slice(0, candidatePageSize));
    mocks.split.mockImplementation(async ({ parentItemId }) => {
      if (parentItemId !== tail.itemId) throw new ApiError(409, 'permanent', undefined, 'LATER_PROCESS_PIECE_COMPLETED');
      return { pieceSetVersion: 1 };
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'permanent-head' })).toEqual({ splitCount: 1,
      skippedCount: stage === 'locked' ? 66 : 0, hasMore: false });
    expect(mocks.query).toHaveBeenCalledTimes(Math.ceil(sqlRows.length / candidatePageSize));
    expect(mocks.split).toHaveBeenCalledTimes(stage === 'locked' ? 67 : 1);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each(['sets', 'details', 'overrides', 'ranks'] as const)('does not begin the next read when %s consumes the runner deadline', async (stage) => {
    mocks.items = [item()];
    const expire = async () => { vi.mocked(performance.now).mockReturnValue(AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS); return new Map(); };
    mocks[stage].mockImplementation(expire);
    expect(await autoSplitSessakuUnits({ siteKey: 'read-deadline' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    const sequence = ['sets', 'details', 'overrides', 'ranks'] as const;
    for (const next of sequence.slice(sequence.indexOf(stage) + 1)) expect(mocks[next]).not.toHaveBeenCalled();
    expect(mocks.projection).not.toHaveBeenCalled(); expect(mocks.split).not.toHaveBeenCalled();
  });
  it.each([false, true])('stops paging at the discovery deadline and retains a retry (tail=%s)', async (hasTail) => {
    mocks.items = Array.from({ length: hasTail ? candidatePageSize : AUTO_UNIT_SPLIT_MAX_LOTS }, (_, i) => item({ itemId: `row:${i}`, sourceRowId: `source-${i}`,
      fhincd: `PART-${i}`, plannedQuantity: 1 }));
    mocks.query.mockResolvedValue(mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId })));
    mocks.projection.mockImplementation(() => {
      vi.mocked(performance.now).mockReturnValue(AUTO_UNIT_SPLIT_BUDGET_MS);
      return { items: mocks.items };
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'paging-deadline' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: hasTail });
    expect(mocks.query).toHaveBeenCalledTimes(1); expect(mocks.audit.mock.calls.filter(([audit]) => audit.action === 'auto_unit_split_lot')).toHaveLength(0);
  });
  it.each(['budget', 'statement-timeout'])('retains a retry when a page after exclusions overruns the discovery deadline (%s)', async (kind) => {
    mocks.items = Array.from({ length: 8 }, (_, i) => item({ itemId: `row:${i}`, sourceRowId: `source-${i}`,
      fhincd: `PART-${i}`, plannedQuantity: 1 }));
    const sqlRows = mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId }));
    mocks.query.mockImplementation(async (sql) => {
      const excluded = sqlExcludedParents(sql);
      if (excluded.size) {
        if (kind === 'statement-timeout') throw Object.assign(new Error('canceling statement due to statement timeout'), { code: 'P2010', meta: { code: '57014' } });
        vi.mocked(performance.now).mockReturnValue(AUTO_UNIT_SPLIT_BUDGET_MS + 1);
      }
      return sqlRows.filter((row) => !excluded.has(row.parentId)).slice(0, candidatePageSize);
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'paging-overrun' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    expect(mocks.query).toHaveBeenCalledTimes(2); expect(mocks.audit.mock.calls.filter(([audit]) => audit.action === 'auto_unit_split_lot')).toHaveLength(0); expect(mocks.split).not.toHaveBeenCalled();
  });
  it('re-evaluates TS process-order rejections on every opening without permanent history', async () => {
    mocks.items = [item({ processOrder: 'A' }), item({ itemId: 'lower', sourceRowId: 'lower', processOrder: 'a' })];
    for (let call = 0; call < 2; call++) {
      expect(await autoSplitSessakuUnits({ siteKey: 'process-rejected' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    }
    expect(mocks.query).toHaveBeenCalledTimes(2); expect(mocks.rows).toHaveBeenCalledTimes(2);
    expect(mocks.split).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
  });
  it('continues across calls after seven TS-rejected heads consume the discovery budget', async () => {
    const rejected = Array.from({ length: 7 }, (_, i) => item({ itemId: `row:slow-${i}`, sourceRowId: `slow-${i}`,
      fhincd: `PART-${i}`, processOrder: 'B' }));
    const tail = item({ itemId: 'row:slow-tail', sourceRowId: 'slow-tail', fhincd: 'TAIL' });
    mocks.items = [...rejected, ...rejected.map((row) => ({ ...row, itemId: `earlier-${row.itemId}`,
      sourceRowId: `earlier-${row.sourceRowId}`, processOrder: 'A', originalResourceCd: '305' })), tail];
    const rows = [...rejected, tail].map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId, inputVersion: 'v1' }));
    mocks.query.mockImplementation(async (sql) => {
      const cached = sql.values.filter((value: unknown) => typeof value === 'string' && value.startsWith('[{'))
        .flatMap((value: string) => JSON.parse(value)) as { parentId: string; inputVersion: string }[];
      return rows.filter((row) => !sqlExcludedParents(sql).has(row.parentId)
        && !cached.some((entry) => entry.parentId === row.parentId && entry.inputVersion === row.inputVersion)).slice(0, candidatePageSize);
    });
    const now = vi.mocked(performance.now);
    mocks.projection.mockImplementationOnce(() => { now.mockReturnValue(3000); return { items: mocks.items }; });
    expect(await autoSplitSessakuUnits({ siteKey: 'cross-call-budget' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    now.mockReturnValue(5000);
    expect(await autoSplitSessakuUnits({ siteKey: 'cross-call-budget' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ parentItemId: tail.itemId }));
    expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each(['AUTO_UNIT_SPLIT_INELIGIBLE', 'RESOURCE_CATEGORY_MISMATCH', 'LATER_PROCESS_PIECE_COMPLETED', 'COMPLETED_PIECE', 'EXTERNALLY_COMPLETED_ITEM'])('remembers unchanged %s heads across calls, then invalidates on input change', async (code) => {
    const heads = Array.from({ length: 3 }, (_, i) => item({ itemId: `row:permanent-${i}`, sourceRowId: `permanent-${i}`, fhincd: `HEAD-${i}` }));
    const tail = item({ itemId: 'row:tail', sourceRowId: 'tail', fhincd: 'TAIL' });
    mocks.items = [...heads, tail];
    const rows = mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId, inputVersion: 'v1' }));
    mocks.query.mockImplementation(async (sql) => {
      const cached = sql.values.filter((value: unknown) => typeof value === 'string' && value.startsWith('[{'))
        .flatMap((value: string) => JSON.parse(value)) as { parentId: string; inputVersion: string }[];
      return rows.filter((row) => !sqlExcludedParents(sql).has(row.parentId)
        && !cached.some((entry) => entry.parentId === row.parentId && entry.inputVersion === row.inputVersion));
    });
    let elapsed = 0;
    mocks.split.mockImplementation(async ({ parentItemId }) => {
      elapsed += 3000; vi.mocked(performance.now).mockReturnValue(elapsed);
      if (parentItemId !== tail.itemId) throw new ApiError(409, 'permanent', undefined, code);
      return { pieceSetVersion: 1 };
    });
    const siteKey = `cached-${code}`;
    for (let call = 0; call < heads.length; call++) {
      expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: true });
    }
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(4);
    rows[0].inputVersion = 'v2';
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: true });
    expect(mocks.split.mock.calls.at(-1)![0].parentItemId).toBe(heads[0].itemId);
  });
  it.each(['P2034', 'STALE_SESSAKU_PIECES', 'STALE_PLANNING_BOARD_ITEM', 'SOURCE_ITEM_MISSING', 'PIECE_REFERENCED'])(
    'does not remember reloadable %s with unchanged inputVersion', async (code) => {
      mocks.items = [item()];
      mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S', parentId: 'row:one', inputVersion: 'v1' }]);
      mocks.split.mockRejectedValueOnce(code === 'P2034' ? Object.assign(new Error('serialization'), { code }) : new ApiError(409, 'reload', undefined, code));
      const siteKey = `reloadable-${code}`;
      expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: true });
      expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
      expect(mocks.query.mock.calls[1][0].sql).not.toContain('JSONB_TO_RECORDSET');
    });
  it('keeps candidate lock waits retryable', async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error('lock timeout'), { code: 'P2010', meta: { code: '55P03' } }));
    expect(await autoSplitSessakuUnits({ siteKey: 'candidate-lock' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    expect(mocks.warn).not.toHaveBeenCalled();
  });
  it('caps later lots at the remaining request budget', async () => {
    mocks.items = [item(), item({ itemId: 'row:two', fhincd: 'TWO' }), item({ itemId: 'row:three', fhincd: 'THREE' })];
    mocks.split.mockImplementationOnce(async ({ deadline }) => {
      expect(deadline).toBe(3000); vi.mocked(performance.now).mockReturnValue(2900);
      return { pieceSetVersion: 1 };
    }).mockImplementationOnce(async ({ deadline }) => {
      expect(deadline).toBe(3000); vi.mocked(performance.now).mockReturnValue(3000);
      return { pieceSetVersion: 1 };
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'remaining' })).toEqual({ splitCount: 2, skippedCount: 0, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(2);
  });
  it('expires structural rejections after three minutes and isolates them by site', async () => {
    mocks.items = [item({ processOrder: 'B' }), item({ itemId: 'earlier', sourceRowId: 'earlier', processOrder: 'A', originalResourceCd: '305' })];
    mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S', parentId: 'row:one', inputVersion: 'v1' }]);
    await autoSplitSessakuUnits({ siteKey: 'ttl' });
    await autoSplitSessakuUnits({ siteKey: 'ttl' });
    expect(mocks.query.mock.calls[1][0].values).toContainEqual(expect.stringContaining('v1'));
    await autoSplitSessakuUnits({ siteKey: 'different-site' });
    expect(mocks.query.mock.calls[2][0].sql).not.toContain('JSONB_TO_RECORDSET');
    vi.mocked(performance.now).mockReturnValue(180000);
    await autoSplitSessakuUnits({ siteKey: 'ttl' });
    expect(mocks.query.mock.calls[3][0].sql).not.toContain('JSONB_TO_RECORDSET');
  });
  it.each([2700, 2950, 3000])('gives the first lot 3000ms after preprocessing takes %sms', async (elapsed) => {
    const now = vi.mocked(performance.now);
    mocks.items = [item()];
    mocks.ranks.mockImplementation(async () => { now.mockReturnValue(elapsed); return { rows: new Map() }; });
    mocks.split.mockImplementation(async ({ deadline }) => {
      expect(deadline).toBe(elapsed + 3000);
      now.mockReturnValue(elapsed + 1000);
      if (performance.now() >= deadline) throw new ApiError(409, 'budget', undefined, 'AUTO_UNIT_SPLIT_BUDGET');
      return { pieceSetVersion: 1 };
    });
    expect(await autoSplitSessakuUnits({ siteKey: `nearly-expired-${elapsed}` })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(1);
  });
  it('attempts the first lot even if candidate discovery consumes the budget', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    mocks.items = [item(), item({ itemId: 'row:two' })];
    mocks.rows.mockImplementation(async () => { now.mockReturnValue(4000); return []; });
    try {
      expect(await autoSplitSessakuUnits({ siteKey: 'slow-discovery' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: true });
      expect(mocks.split).toHaveBeenCalledTimes(1);
      expect(mocks.split).toHaveBeenCalledWith(expect.objectContaining({ deadline: 7000 }));
    } finally { now.mockRestore(); }
  });
  it.each([AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS - AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS,
    AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS + 1])('does not start a split after runner discovery consumes %sms', async (elapsed) => {
    const now = vi.mocked(performance.now).mockReturnValue(0);
    mocks.items = [item()];
    mocks.rows.mockImplementation(async () => { now.mockReturnValue(elapsed); return []; });
    expect(await autoSplitSessakuUnits({ siteKey: `expired-${elapsed}` })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    expect(mocks.split).not.toHaveBeenCalled();
  });
  it('clamps the lot timeout to the runner deadline and stops before another lot', async () => {
    const now = vi.mocked(performance.now).mockReturnValue(0);
    const safeDeadline = AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS - AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS;
    mocks.items = [item(), item({ itemId: 'row:two' })];
    mocks.rows.mockImplementation(async () => { now.mockReturnValue(safeDeadline - 500); return []; });
    mocks.split.mockImplementation(async () => { now.mockReturnValue(AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS + 1); });
    expect(await autoSplitSessakuUnits({ siteKey: 'runner-grace' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: true });
    expect(mocks.split).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ deadline: safeDeadline }));
    expect(AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS).toBeGreaterThan(AUTO_UNIT_SPLIT_BUDGET_MS + AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS + AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS, maxWait: 1000 });
  });
  it('preserves the existing creation feature gate', async () => {
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'false');
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.audit.mock.calls.filter(([audit]) => audit.action === 'auto_unit_split_lot')).toHaveLength(0); expect(mocks.tryLock).not.toHaveBeenCalled();
    expect(mocks.split).not.toHaveBeenCalled();
  });
});
