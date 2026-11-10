import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
const mocks = vi.hoisted(() => ({ split: vi.fn(), items: [] as GrindingPlanningBoardItem[], query: vi.fn(),
  transaction: vi.fn(), tryLock: vi.fn(), timeout: vi.fn(), state: vi.fn(), ensureState: vi.fn(), policy: vi.fn(), capacity: vi.fn(), details: vi.fn(), warn: vi.fn(), sets: vi.fn(), history: vi.fn(), projection: vi.fn(), rows: vi.fn(), mark: vi.fn(), audit: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: {
  $transaction: mocks.transaction,
  $queryRaw: mocks.query,
  productionScheduleGrindingPlanningBoardState: { findUniqueOrThrow: mocks.state },
  productionScheduleSessakuPieceHistory: { findMany: mocks.history, createMany: mocks.mark },
  productionScheduleSessakuPieceSet: { findMany: mocks.sets }
} }));
vi.mock('../../../../lib/logger.js', () => ({ logger: { warn: mocks.warn, info: vi.fn() } }));
vi.mock('../../grinding-planning-board/state.js', () => ({ ensurePlanningBoardState: mocks.ensureState, stateOrder: () => ['S'] }));
vi.mock('../../grinding-planning-board/source.js', () => ({ readWinnerRowsByFseibans: mocks.rows, readRowDetails: mocks.details,
  readOverrides: async () => new Map(), readRanks: async () => ({ rows: new Map() }) }));
vi.mock('../piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../piece-key.js')>(), readSessakuPieceSets: async () => new Map() }));
vi.mock('../../grinding-planning-board-projection.js', () => ({ projectGrindingPlanningBoard: mocks.projection, buildGrindingPlanningBoardRowItemId: vi.fn() }));
vi.mock('../../grinding-planning-board-resource-capacity.service.js', () => ({ getGrindingPlanningBoardResourceCapacity: mocks.capacity }));
vi.mock('../../policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: mocks.policy, isProductionScheduleCuttingResourceCd: (cd: string) => cd !== '305' }));
vi.mock('../sessaku-pieces.service.js', () => ({ splitSessakuPieces: mocks.split }));
vi.mock('../piece-audit.js', () => ({ runSessakuPieceOperation: mocks.audit }));
import { autoSplitSessakuUnits, autoUnitSplitCandidates, AUTO_UNIT_SPLIT_MAX_LOTS, AUTO_UNIT_SPLIT_MAX_EXCLUDED_PARENTS,
  AUTO_UNIT_SPLIT_BUDGET_MS, AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS, AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS,
  AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS } from '../auto-unit-split.service.js';
import { sessakuPieceParentItemId } from '../piece-key.js';
import { ApiError } from '../../../../lib/errors.js';

const item = (patch: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'row:one', kind: 'row', fseiban: 'S', fhincd: 'PART', processOrder: '10', originalResourceCd: '021', effectiveResourceCd: '021',
  plannedQuantity: 3, itemRevision: 'a'.repeat(64), isCompleted: false, sourceRowId: 'source', ...patch
} as GrindingPlanningBoardItem);
const sqlExcludedParents = (sql: { values: unknown[] }) => new Set(sql.values.filter(Array.isArray).flat()
  .filter((value): value is string => typeof value === 'string' && value.startsWith('row:')));
const capacity = { dailyHoursByResource: {}, runsThroughBreaksResources: [] };
const candidates = (items: GrindingPlanningBoardItem[]) => autoUnitSplitCandidates(items, capacity, (cd) => cd !== '305');

describe('automatic unit split', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true'); mocks.items = [];
    mocks.audit.mockImplementation(async (audit, callback) => callback(audit));
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: (sql: { sql?: string } | TemplateStringsArray, ...values: unknown[]) => Array.isArray(sql)
        ? sql.join('').includes('set_config') ? mocks.timeout(sql, ...values) : mocks.tryLock(sql, ...values)
        : mocks.query(sql),
      productionScheduleGrindingPlanningBoardState: { findUniqueOrThrow: mocks.state },
      productionScheduleSessakuPieceSet: { findMany: mocks.sets },
      productionScheduleSessakuPieceHistory: { findMany: mocks.history }
    }));
    mocks.state.mockResolvedValue({ seibanOrder: ['S'] });
    mocks.policy.mockResolvedValue({ grindingResourceCds: ['305'], cuttingExcludedResourceCds: [] });
    mocks.capacity.mockResolvedValue({}); mocks.details.mockResolvedValue(new Map());
    vi.spyOn(performance, 'now').mockReturnValue(0);
    mocks.tryLock.mockResolvedValue([{ acquired: true }]); mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S' }]);
    mocks.sets.mockResolvedValue([]); mocks.history.mockResolvedValue([]); mocks.rows.mockResolvedValue([]);
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
    { pieceSetVersion: 1 }, { pieceSetVersion: 7 }, { kind: 'piece', sourcePieceId: 'source' }
  ] as Partial<GrindingPlanningBoardItem>[])('excludes ineligible lots %j', (patch) => {
    expect(candidates([item(patch)])).toHaveLength(0);
  });
  it('excludes a touched logical key even after its PieceSet has been removed', () => {
    expect(autoUnitSplitCandidates([item()], capacity, () => true, new Set(['row:one']))).toEqual([]);
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
    mocks.split.mockImplementation(async () => { mocks.items = [item({ pieceSetVersion: 1 })]; });
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledWith(expect.objectContaining({ siteKey: 'site', expectedPieceSetVersion: 0,
      quantities: [1, 1, 1], autoUnitSplit: true, audit: expect.objectContaining({ action: 'auto_unit_split_lot' }) }));
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(1);
  });
  it('continues after a structural per-lot 409 and bounds the number of attempted transactions', async () => {
    mocks.items = Array.from({ length: 6 }, (_, i) => item({ itemId: `row:${Buffer.from(JSON.stringify(['S', `PART-${i}`, '021', '10'])).toString('base64url')}`, fhincd: `PART-${i}` }));
    expect(AUTO_UNIT_SPLIT_MAX_LOTS).toBe(5);
    mocks.split.mockRejectedValueOnce(new ApiError(409, 'later completed', undefined, 'LATER_PROCESS_PIECE_COMPLETED')).mockResolvedValue({});
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: AUTO_UNIT_SPLIT_MAX_LOTS - 1, skippedCount: 1, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(AUTO_UNIT_SPLIT_MAX_LOTS);
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
    expect(mocks.sets).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each([new Error('connection lost'), new ApiError(500, 'timeout')])(
    'stops and rethrows unexpected errors', async (error) => {
      mocks.items = [item(), item({ itemId: 'row:two' })]; mocks.split.mockRejectedValueOnce(error);
      await expect(autoSplitSessakuUnits({ siteKey: 'site' })).rejects.toBe(error);
      expect(mocks.split).toHaveBeenCalledTimes(1);
    });
  it('counts only touched lots from this request candidates and selects only logical keys', async () => {
    const key = { fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10' };
    const id = `row:${Buffer.from(JSON.stringify(Object.values(key))).toString('base64url')}`;
    mocks.items = [item({ itemId: id }), item({ isCompleted: true }), item({ originalResourceCd: '305' })];
    mocks.history.mockResolvedValue([key]);
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(mocks.sets).toHaveBeenCalledWith(expect.objectContaining({ select: { fseiban: true, fhincd: true, fsigencd: true, fkojun: true } }));
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
    mocks.query.mockResolvedValue(mocks.items.slice(0, 6).map((item) => ({ id: item.sourceRowId, fseiban: 'S' })));
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 5, skippedCount: 0, hasMore: true });
  });
  it('gets past 5 permanent conflicts on the next request', async () => {
    const keys = Array.from({ length: 6 }, (_, i) => ({ fseiban: 'S', fhincd: `PART-${i}`, fsigencd: '021', fkojun: '10' }));
    mocks.items = keys.map((key) => item({ itemId: `row:${Buffer.from(JSON.stringify(Object.values(key))).toString('base64url')}`, fhincd: key.fhincd }));
    mocks.mark.mockImplementation(async ({ data }) => { touched.push(...data); });
    const touched: typeof keys = [];
    mocks.history.mockImplementation(async () => touched);
    mocks.split.mockRejectedValue(new ApiError(409, 'later completed', undefined, 'LATER_PROCESS_PIECE_COMPLETED'));
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toMatchObject({ skippedCount: 5, hasMore: true });
    mocks.split.mockResolvedValue({});
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toMatchObject({ splitCount: 1, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(6); expect(mocks.mark).toHaveBeenCalledTimes(5);
  });
  it.each(['STALE_SESSAKU_PIECES', 'AUTO_UNIT_SPLIT_ALREADY_TOUCHED', 'AUTO_UNIT_SPLIT_INELIGIBLE', 'PIECE_QUANTITY_CONFLICT', 'P2034'])(
    'continues to the next lot after %s', async (code) => {
      mocks.items = [item(), item({ itemId: 'row:two', fhincd: 'OTHER' })];
      mocks.split.mockRejectedValueOnce(code === 'P2034' ? Object.assign(new Error('serialization'), { code }) : new ApiError(409, 'changed', undefined, code));
      expect(await autoSplitSessakuUnits({ siteKey: 'continue' })).toEqual({ splitCount: 1, skippedCount: 1,
        hasMore: code === 'P2034' });
      expect(mocks.split).toHaveBeenCalledTimes(2); expect(mocks.mark).not.toHaveBeenCalled();
    });
  it.each(['AUTO_UNIT_SPLIT_BUSY', 'AUTO_UNIT_SPLIT_BUDGET'])('stops the lot loop on %s', async (code) => {
    mocks.items = [item(), item({ itemId: 'row:two', fhincd: 'OTHER' })];
    mocks.split.mockRejectedValueOnce(new ApiError(409, 'retry', undefined, code));
    expect(await autoSplitSessakuUnits({ siteKey: 'busy' })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: true });
    expect(mocks.split).toHaveBeenCalledTimes(1);
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
  it.each([400, 409])('does not request retry for a quantity conflict with status %s', async (statusCode) => {
    mocks.items = [item()];
    mocks.split.mockRejectedValueOnce(new ApiError(statusCode, 'quantity changed', undefined, 'PIECE_QUANTITY_CONFLICT'));
    expect(await autoSplitSessakuUnits({ siteKey: `quantity-${statusCode}` })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(1);
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
      expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.split).not.toHaveBeenCalled();
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
    expect(mocks.timeout.mock.calls.map(([, value]) => value)).toEqual(['9000ms', '9000ms', '9000ms', '9000ms', '500ms']);
    expect(mocks.rows.mock.calls[0][0]).toEqual(expect.objectContaining({ $queryRaw: expect.any(Function) }));
    expect(mocks.rows.mock.calls[0][0].$queryRaw).not.toBe(mocks.query);
    expect(mocks.sets.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.timeout.mock.invocationCallOrder.at(-1)!);
  });
  it('returns hasMore and stops preprocessing after a statement timeout', async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(new Error('statement timeout'), { code: 'P2010', meta: { code: '57014' } }));
    expect(await autoSplitSessakuUnits({ siteKey: 'statement-cancelled' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.rows).not.toHaveBeenCalled(); expect(mocks.split).not.toHaveBeenCalled();
  });
  it.each([' PART', 'PART ', 'ＰＡＲＴ'])('excludes different raw part keys that cannot propagate: %j', (fhincd) => {
    expect(candidates([item(), item({ itemId: 'later', processOrder: '20', fhincd })])).toEqual([]);
  });
  it('uses separate request and lot audit actions and scopes key reads to candidate seibans', async () => {
    mocks.items = [item()];
    await autoSplitSessakuUnits({ siteKey: 'site' });
    expect(mocks.audit.mock.calls.map(([audit]) => audit.action)).toEqual(['auto_unit_split', 'auto_unit_split_lot']);
    for (const fn of [mocks.sets, mocks.history]) expect(fn).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ fseiban: { in: ['S'] } }) }));
  });
  it('stops at the wall-clock budget and uses a bounded outer transaction', async () => {
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
  it('keeps already committed lot counts when the outer transaction times out on exit', async () => {
    mocks.items = [item()];
    const transaction = mocks.transaction.getMockImplementation()!;
    mocks.transaction.mockImplementationOnce(async (callback) => {
      await transaction(callback);
      throw Object.assign(new Error('runner expired'), { code: 'P2028' });
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'runner-exit' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: true });
  });
  it('queries candidates with LIMIT 6 on every request, including consecutive empty results', async () => {
    mocks.query.mockResolvedValue([]);
    for (const siteKey of ['site', 'site', 'other']) {
      expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    }
    expect(mocks.query).toHaveBeenCalledTimes(3);
    for (const [sql] of mocks.query.mock.calls) {
      expect(sql.sql).toContain('WITH untouched');
      expect(sql.values.at(-1)).toBe(6);
    }
    mocks.items = [item()];
    mocks.query.mockResolvedValue([{ id: 'source', fseiban: 'S' }]);
    expect(await autoSplitSessakuUnits({ siteKey: 'site' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.query).toHaveBeenCalledTimes(4);
  });
  it.each(['projection', 'missing-projection', 'touched', 'locked-ineligible', 'locked-structural'])('finishes after paging past a full page skipped by %s with no tail', async (stage) => {
    const keys = Array.from({ length: 6 }, (_, i) => ({ fseiban: 'S', fhincd: `PART-${i}`, fsigencd: '021', fkojun: '10' }));
    mocks.items = keys.map((key, i) => item({ itemId: sessakuPieceParentItemId(key), fhincd: key.fhincd, sourceRowId: `source-${i}`,
      plannedQuantity: stage === 'projection' ? 1 : 3 }));
    const sqlRows = mocks.items.map((item) => ({ id: item.sourceRowId, fseiban: 'S', parentId: item.itemId }));
    mocks.query.mockImplementation(async (sql) => sqlRows.filter((row) => !sqlExcludedParents(sql).has(row.parentId)));
    if (stage === 'touched') mocks.history.mockResolvedValue(keys);
    if (stage === 'missing-projection') mocks.items = [];
    const locked = stage.startsWith('locked');
    if (locked) mocks.split.mockRejectedValue(new ApiError(409, 'ineligible', undefined,
      stage === 'locked-structural' ? 'AUTO_UNIT_SPLIT_STRUCTURALLY_INELIGIBLE' : 'AUTO_UNIT_SPLIT_INELIGIBLE'));
    for (let call = 0; call < 2; call++) {
      expect(await autoSplitSessakuUnits({ siteKey: 'rejected-page' })).toEqual({ splitCount: 0,
        skippedCount: stage === 'touched' ? 6 : locked ? 5 : 0, hasMore: false });
    }
    expect(mocks.query).toHaveBeenCalledTimes(locked ? 2 : 4);
    expect(mocks.split).toHaveBeenCalledTimes(locked ? 10 : 0);
    expect(mocks.mark).not.toHaveBeenCalled();
    if (!locked) expect(mocks.audit).not.toHaveBeenCalled();
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
    mocks.query.mockImplementation(async (sql) => sqlRows.filter((row) => !sqlExcludedParents(sql).has(row.parentId)).slice(0, 6));
    // A subsequent opening sees the successful lot removed, rather than retrying an empty first page forever.
    mocks.split.mockImplementation(async () => { sqlRows.pop(); });
    expect(await autoSplitSessakuUnits({ siteKey: 'paged' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.query).toHaveBeenCalledTimes(3);
    expect(mocks.split).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ parentItemId: tail.itemId }));
    expect(await autoSplitSessakuUnits({ siteKey: 'paged' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(1);
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it('counts touched parents only once across pages even when all siblings are projected again', async () => {
    const keys = Array.from({ length: 12 }, (_, i) => ({ fseiban: 'S', fhincd: `PART-${i}`, fsigencd: '021', fkojun: '10' }));
    const touched = keys.map((key, i) => item({ itemId: sessakuPieceParentItemId(key), sourceRowId: `touched-${i}`, fhincd: key.fhincd }));
    const tail = item({ itemId: 'row:tail', sourceRowId: 'tail', fhincd: 'TAIL' });
    mocks.items = [...touched, tail]; mocks.history.mockResolvedValue(keys);
    const sqlRows = mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId }));
    mocks.query.mockImplementation(async (sql) => sqlRows.filter((row) => !sqlExcludedParents(sql).has(row.parentId)).slice(0, 6));
    expect(await autoSplitSessakuUnits({ siteKey: 'paged-touched' })).toEqual({ splitCount: 1, skippedCount: 12, hasMore: false });
    expect(mocks.split).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ parentItemId: tail.itemId }));
  });
  it.each([65, 66, 67])('bounds exclusions at 60 and reports no futile retry for %s TS-rejected rows', async (count) => {
    mocks.items = Array.from({ length: count }, (_, i) => item({ itemId: `row:${i}`, sourceRowId: `source-${i}`,
      fhincd: `PART-${i}`, plannedQuantity: 1 }));
    const sqlRows = mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId }));
    mocks.query.mockImplementation(async (sql) => {
      const excluded = sqlExcludedParents(sql);
      expect(excluded.size).toBeLessThanOrEqual(AUTO_UNIT_SPLIT_MAX_EXCLUDED_PARENTS);
      return sqlRows.filter((row) => !excluded.has(row.parentId)).slice(0, 6);
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'exclusion-cap' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.query).toHaveBeenCalledTimes(11);
    expect(sqlExcludedParents(mocks.query.mock.calls.at(-1)![0]).size).toBe(60);
    expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.split).not.toHaveBeenCalled();
    expect(mocks.mark).not.toHaveBeenCalled();
  });
  it.each([false, true])('stops paging at the discovery deadline without inviting a retry (tail=%s)', async (hasTail) => {
    mocks.items = Array.from({ length: hasTail ? 6 : 5 }, (_, i) => item({ itemId: `row:${i}`, sourceRowId: `source-${i}`,
      fhincd: `PART-${i}`, plannedQuantity: 1 }));
    mocks.query.mockResolvedValue(mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId })));
    mocks.projection.mockImplementation(() => {
      vi.mocked(performance.now).mockReturnValue(AUTO_UNIT_SPLIT_BUDGET_MS);
      return { items: mocks.items };
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'paging-deadline' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.query).toHaveBeenCalledTimes(1); expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(['budget', 'statement-timeout'])('reports no retry when a page after exclusions overruns the discovery deadline (%s)', async (kind) => {
    mocks.items = Array.from({ length: 8 }, (_, i) => item({ itemId: `row:${i}`, sourceRowId: `source-${i}`,
      fhincd: `PART-${i}`, plannedQuantity: 1 }));
    const sqlRows = mocks.items.map((row) => ({ id: row.sourceRowId, fseiban: 'S', parentId: row.itemId }));
    mocks.query.mockImplementation(async (sql) => {
      const excluded = sqlExcludedParents(sql);
      if (excluded.size) {
        if (kind === 'statement-timeout') throw Object.assign(new Error('canceling statement due to statement timeout'), { code: 'P2010', meta: { code: '57014' } });
        vi.mocked(performance.now).mockReturnValue(AUTO_UNIT_SPLIT_BUDGET_MS + 1);
      }
      return sqlRows.filter((row) => !excluded.has(row.parentId)).slice(0, 6);
    });
    expect(await autoSplitSessakuUnits({ siteKey: 'paging-overrun' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.query).toHaveBeenCalledTimes(2); expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.split).not.toHaveBeenCalled();
  });
  it('re-evaluates TS process-order rejections on every opening without permanent history', async () => {
    mocks.items = [item({ processOrder: 'A' }), item({ itemId: 'lower', sourceRowId: 'lower', processOrder: 'a' })];
    for (let call = 0; call < 2; call++) {
      expect(await autoSplitSessakuUnits({ siteKey: 'process-rejected' })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    }
    expect(mocks.query).toHaveBeenCalledTimes(2); expect(mocks.rows).toHaveBeenCalledTimes(2);
    expect(mocks.split).not.toHaveBeenCalled(); expect(mocks.mark).not.toHaveBeenCalled();
  });
  it('attempts the first lot even if candidate discovery consumes the budget', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    mocks.items = [item(), item({ itemId: 'row:two' })];
    mocks.rows.mockImplementation(async () => { now.mockReturnValue(4000); return []; });
    try {
      expect(await autoSplitSessakuUnits({ siteKey: 'slow-discovery' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: true });
      expect(mocks.split).toHaveBeenCalledTimes(1);
      expect(mocks.split).toHaveBeenCalledWith(expect.objectContaining({ deadline: 5000 }));
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
  it('clamps the first-lot grace to the runner deadline and stops before another lot', async () => {
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
    expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.tryLock).not.toHaveBeenCalled();
    expect(mocks.split).not.toHaveBeenCalled();
  });
});
