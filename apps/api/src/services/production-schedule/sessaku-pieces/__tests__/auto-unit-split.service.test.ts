import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
const mocks = vi.hoisted(() => ({ split: vi.fn(), items: [] as GrindingPlanningBoardItem[], query: vi.fn(),
  transaction: vi.fn(), fingerprint: "initial", tryLock: vi.fn(), timeout: vi.fn(), state: vi.fn(), ensureState: vi.fn(), policy: vi.fn(), capacity: vi.fn(), details: vi.fn(), warn: vi.fn(), sets: vi.fn(), history: vi.fn(), projection: vi.fn(), rows: vi.fn(), mark: vi.fn(), audit: vi.fn() }));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: {
  $transaction: mocks.transaction,
  $queryRaw: mocks.query,
  productionScheduleGrindingPlanningBoardState: { findUniqueOrThrow: mocks.state },
  productionScheduleSessakuPieceHistory: { findMany: mocks.history, createMany: mocks.mark },
  productionScheduleSessakuPieceSet: { findMany: mocks.sets }
} }));
vi.mock('../../../../lib/logger.js', () => ({ logger: { warn: mocks.warn } }));
vi.mock('../../grinding-planning-board/state.js', () => ({ ensurePlanningBoardState: mocks.ensureState, stateOrder: () => ['S'] }));
vi.mock('../../grinding-planning-board/source.js', () => ({ readWinnerRowsByFseibans: mocks.rows, readRowDetails: mocks.details,
  readOverrides: async () => new Map(), readRanks: async () => ({ rows: new Map() }) }));
vi.mock('../piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../piece-key.js')>(), readSessakuPieceSets: async () => new Map() }));
vi.mock('../../grinding-planning-board-projection.js', () => ({ projectGrindingPlanningBoard: mocks.projection, buildGrindingPlanningBoardRowItemId: vi.fn() }));
vi.mock('../../grinding-planning-board-resource-capacity.service.js', () => ({ getGrindingPlanningBoardResourceCapacity: mocks.capacity }));
vi.mock('../../policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: mocks.policy, isProductionScheduleCuttingResourceCd: (cd: string) => cd !== '305' }));
vi.mock('../sessaku-pieces.service.js', () => ({ splitSessakuPieces: mocks.split }));
vi.mock('../piece-audit.js', () => ({ runSessakuPieceOperation: mocks.audit }));
import { autoSplitSessakuUnits, autoUnitSplitCandidates, AUTO_UNIT_SPLIT_MAX_LOTS,
  AUTO_UNIT_SPLIT_BUDGET_MS, AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS, AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS,
  AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS, AUTO_UNIT_SPLIT_EMPTY_TTL_MS } from '../auto-unit-split.service.js';
import { autoUnitSplitInputKey } from '../auto-unit-split-candidates.js';
import { sessakuPieceParentItemId } from '../piece-key.js';
import { ApiError } from '../../../../lib/errors.js';

const item = (patch: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'row:one', kind: 'row', fseiban: 'S', fhincd: 'PART', processOrder: '10', originalResourceCd: '021', effectiveResourceCd: '021',
  plannedQuantity: 3, itemRevision: 'a'.repeat(64), isCompleted: false, sourceRowId: 'source', ...patch
} as GrindingPlanningBoardItem);
let generation = 0;
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
    mocks.fingerprint = String(++generation);
    vi.spyOn(performance, 'now').mockReturnValue(generation * 20000);
    mocks.tryLock.mockResolvedValue([{ acquired: true }]); mocks.query.mockImplementation(async (sql) => sql.sql.startsWith('SELECT MD5') ? [{ fingerprint: mocks.fingerprint }] : [{ id: 'source', fseiban: 'S' }]);
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
    mocks.query.mockImplementation(async (sql) => sql.sql.startsWith('SELECT MD5') ? [{ fingerprint: mocks.fingerprint }] : []);
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
    mocks.query.mockImplementation(async (sql) => sql.sql.startsWith('SELECT MD5') ? [{ fingerprint: mocks.fingerprint }]
      : mocks.items.slice(0, 6).map((item) => ({ id: item.sourceRowId, fseiban: 'S' })));
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
  it('caches STRUCTURALLY_INELIGIBLE with the SQL input even when projection input differs, and invalidates it on input change', async () => {
    mocks.items = [item()];
    const siteKey = 'ineligible-racing-input';
    const oldInput = 'sql-before-csv-change';
    let inputKey = oldInput;
    mocks.query.mockImplementation(async (sql) => {
      if (sql.sql.startsWith('SELECT MD5')) return [{ fingerprint: mocks.fingerprint }];
      const exclusions = JSON.parse(sql.values.find((value: unknown) => typeof value === 'string' && value.startsWith('[')) as string);
      return exclusions.some((entry: { parentId: string; inputKey: string }) => entry.parentId === 'row:one' && entry.inputKey === inputKey)
        ? [] : [{ id: 'source', fseiban: 'S', parentId: 'row:one', inputKey }];
    });
    mocks.split.mockRejectedValueOnce(new ApiError(409, 'predecessor', undefined, 'AUTO_UNIT_SPLIT_STRUCTURALLY_INELIGIBLE'));
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.rows).toHaveBeenCalledTimes(1);
    expect(mocks.query.mock.calls.at(-1)?.[0].values).toContain(JSON.stringify([{ parentId: 'row:one', inputKey: oldInput, fseiban: 'S' }]));
    vi.mocked(performance.now).mockReturnValue(performance.now() + AUTO_UNIT_SPLIT_EMPTY_TTL_MS);
    mocks.fingerprint = 'csv-key-changed'; inputKey = 'new-winner-input';
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(2);
  });
  it.each(['OFF→ON', 'quantity 2→1→2'])('does not cache temporary ineligibility after %s with unchanged logical keys', async (change) => {
    mocks.items = [item({ plannedQuantity: 2 })];
    let enabled = true;
    let quantity = 2;
    const siteKey = `temporary-${change}`;
    mocks.query.mockImplementation(async (sql) => {
      if (sql.sql.startsWith('SELECT MD5')) return [{ fingerprint: mocks.fingerprint }];
      const exclusions = JSON.parse(sql.values.find((value: unknown) => typeof value === 'string' && value.startsWith('[')) as string);
      expect(exclusions).toEqual([]);
      return enabled && quantity >= 2 ? [{ id: 'source', fseiban: 'S', parentId: 'row:one', inputKey: 'unchanged-keys' }] : [];
    });
    // The setting/quantity changes after discovery but before the locked recheck.
    mocks.split.mockImplementationOnce(async () => {
      if (change === 'OFF→ON') enabled = false;
      else quantity = 1;
      mocks.fingerprint = 'temporary-state';
      throw new ApiError(409, 'temporarily ineligible', undefined, 'AUTO_UNIT_SPLIT_INELIGIBLE');
    }).mockResolvedValue({});
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 1, hasMore: false });
    expect(mocks.split).toHaveBeenCalledTimes(1);
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    enabled = true; quantity = 2; mocks.fingerprint = 'restored-state';
    vi.mocked(performance.now).mockReturnValue(performance.now() + AUTO_UNIT_SPLIT_EMPTY_TTL_MS);
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
  it.each(['lock', 'ensureState', 'state', 'policy', 'fingerprint', 'candidate', 'winners', 'parallel', 'projection'])(
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
        case 'fingerprint': mocks.query.mockImplementationOnce(async () => { expire(); return [{ fingerprint: mocks.fingerprint }]; }); break;
        case 'candidate': mocks.query.mockResolvedValueOnce([{ fingerprint: mocks.fingerprint }])
          .mockImplementationOnce(async () => { expire(); return []; }); break;
        case 'winners': mocks.rows.mockImplementationOnce(async () => { expire(); return []; }); break;
        case 'parallel': mocks.details.mockImplementationOnce(async () => { expire(); return new Map(); }); break;
        case 'projection': mocks.projection.mockImplementationOnce(() => { expire(); return { items: mocks.items }; }); break;
      }
      expect(await autoSplitSessakuUnits({ siteKey: `preprocessing-${stage}` })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: true });
      const nextIndex = { lock: 1, ensureState: 2, state: 3, policy: 4, fingerprint: 5, candidate: 5, winners: 6, parallel: 7, projection: 8 }[stage]!;
      for (const fn of stages.slice(nextIndex)) expect(fn).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled(); expect(mocks.split).not.toHaveBeenCalled();
      // Expiry must not populate the empty cache, even for an empty SQL result.
      now.mockReturnValue(AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS);
      mocks.query.mockImplementation(async (sql) => sql.sql.startsWith('SELECT MD5') ? [{ fingerprint: mocks.fingerprint }] : [{ id: 'source', fseiban: 'S' }]);
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
  it.each([true, false])('caches structural rejections only with a matching CSV input snapshot (match=%s)', async (matching) => {
    mocks.items = [item({ processOrder: 'A' }), item({ itemId: 'lower', sourceRowId: 'lower', processOrder: 'a' })];
    const keys = ['A', 'a'].map((fkojun) => ({ fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun }));
    mocks.rows.mockResolvedValue(keys.map((key) => ({ rowData: { FSEIBAN: key.fseiban, FHINCD: key.fhincd, FSIGENCD: key.fsigencd, FKOJUN: key.fkojun } })));
    const inputKey = matching ? autoUnitSplitInputKey(keys.map(sessakuPieceParentItemId)) : 'another-csv-snapshot';
    mocks.query.mockImplementation(async (sql) => {
      const excluded = sql.values.find((value: unknown) => typeof value === 'string' && value.startsWith('[{'));
      if (sql.sql.startsWith('SELECT MD5')) return [{ fingerprint: mocks.fingerprint }];
      return excluded ? [] : [{ id: 'source', fseiban: 'S', parentId: 'row:one', inputKey }];
    });
    const siteKey = `cache-${matching}`;
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(await autoSplitSessakuUnits({ siteKey })).toEqual({ splitCount: 0, skippedCount: 0, hasMore: false });
    expect(mocks.rows).toHaveBeenCalledTimes(matching ? 1 : 2); expect(mocks.mark).not.toHaveBeenCalled(); expect(mocks.audit).not.toHaveBeenCalled();
    if (matching) expect(mocks.query.mock.calls.at(-1)?.[0].values).toContain(JSON.stringify([{ parentId: 'row:one', inputKey, fseiban: 'S' }]));
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
  it('queries candidates once with LIMIT 6 and bypasses the CTE for unchanged empty inputs', async () => {
    mocks.query.mockImplementation(async (sql) => sql.sql.startsWith('SELECT MD5') ? [{ fingerprint: mocks.fingerprint }] : []);
    await autoSplitSessakuUnits({ siteKey: 'empty' });
    await autoSplitSessakuUnits({ siteKey: 'empty' });
    const queries = mocks.query.mock.calls.map(([sql]) => sql);
    expect(queries.filter((sql) => sql.sql.includes('WITH untouched'))).toHaveLength(1);
    expect(queries.filter((sql) => sql.sql.startsWith('SELECT MD5'))).toHaveLength(1);
    expect(queries.find((sql) => sql.sql.includes('WITH untouched')).values.at(-1)).toBe(6);
    expect(queries.some((sql) => sql.sql.startsWith('SELECT EXISTS'))).toBe(false);
    mocks.fingerprint = 'changed-csv-quantity-settings-progress';
    vi.mocked(performance.now).mockReturnValue(performance.now() + AUTO_UNIT_SPLIT_EMPTY_TTL_MS);
    mocks.items = [item()];
    mocks.query.mockImplementation(async (sql) => sql.sql.startsWith('SELECT MD5') ? [{ fingerprint: mocks.fingerprint }] : [{ id: 'source', fseiban: 'S' }]);
    expect(await autoSplitSessakuUnits({ siteKey: 'empty' })).toEqual({ splitCount: 1, skippedCount: 0, hasMore: false });
  });
  it('caches empty results per site for 5 seconds, then checks the fingerprint and renews the TTL', async () => {
    const now = vi.mocked(performance.now).mockReturnValue(0);
    mocks.query.mockImplementation(async (sql) => sql.sql.startsWith('SELECT MD5') ? [{ fingerprint: mocks.fingerprint }] : []);
    await autoSplitSessakuUnits({ siteKey: 'ttl' });
    now.mockReturnValue(AUTO_UNIT_SPLIT_EMPTY_TTL_MS - 1);
    await autoSplitSessakuUnits({ siteKey: 'ttl' });
    expect(mocks.query).toHaveBeenCalledTimes(2);
    await autoSplitSessakuUnits({ siteKey: 'ttl-other' });
    expect(mocks.query).toHaveBeenCalledTimes(4);
    now.mockReturnValue(AUTO_UNIT_SPLIT_EMPTY_TTL_MS);
    await autoSplitSessakuUnits({ siteKey: 'ttl' });
    expect(mocks.query).toHaveBeenCalledTimes(5);
    expect(mocks.query.mock.calls.at(-1)?.[0].sql).toMatch(/^SELECT MD5/);
    now.mockReturnValue(AUTO_UNIT_SPLIT_EMPTY_TTL_MS * 2 - 1);
    await autoSplitSessakuUnits({ siteKey: 'ttl' });
    expect(mocks.query).toHaveBeenCalledTimes(5);
  });
  it('does not apply the empty TTL to a positive candidate result', async () => {
    mocks.items = [item()];
    await autoSplitSessakuUnits({ siteKey: 'positive' });
    await autoSplitSessakuUnits({ siteKey: 'positive' });
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.split).toHaveBeenCalledTimes(2);
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
