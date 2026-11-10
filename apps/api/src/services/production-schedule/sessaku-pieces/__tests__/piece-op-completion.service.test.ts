import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { SessakuPieceSet } from '../piece-key.js';
import type { GrindingPlanningBoardProjectionRowDetail } from '../../grinding-planning-board-projection.js';
import type { PieceAuditContext } from '../piece-audit.js';

const mocks = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    productionScheduleGrindingPlanningBoardState: { findMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    productionScheduleGrindingPlanningBoardOverride: { findMany: vi.fn() },
    productionScheduleOrderAssignment: { findMany: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceCapacity: { findMany: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceMinutesSource: { findMany: vi.fn() },
    productionScheduleGrindingPlanningBoardResourcePartMinutes: { findMany: vi.fn() },
    productionScheduleGrindingPlanningBoardResourcePartOpMinutes: { findMany: vi.fn() },
    productionScheduleSessakuPieceHistory: { findUnique: vi.fn(), upsert: vi.fn() },
    productionScheduleSessakuPieceSet: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), create: vi.fn() },
    productionScheduleSessakuPiece: { update: vi.fn(), createMany: vi.fn() },
    productionScheduleSessakuPieceOpCompletion: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() }
  },
  transaction: vi.fn(), readSet: vi.fn(), winner: vi.fn(), rows: vi.fn(), details: vi.fn(), sets: vi.fn(),
  logicalLocks: vi.fn(), progress: vi.fn(), quantities: vi.fn(), audit: vi.fn()
}));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { ...mocks.tx, $transaction: mocks.transaction } }));
vi.mock('../../grinding-planning-board/state.js', () => ({ ensurePlanningBoardState: vi.fn(), stateOrder: () => ['S'] }));
vi.mock('../../grinding-planning-board/source.js', () => ({
  readWinnerRowsByLogicalKeyFseibans: mocks.rows, readWinnerRowsByFseibans: mocks.rows,
  readRowDetails: mocks.details, readOverrides: async () => new Map(), readRanks: async () => ({ rows: new Map() })
}));
vi.mock('../piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../piece-key.js')>(),
  readSessakuPieceSet: mocks.readSet, readSessakuPieceSets: mocks.sets, findSessakuPieceWinner: mocks.winner,
  acquireSessakuPieceLogicalLocks: mocks.logicalLocks, acquireSessakuPieceBoardStateLocks: vi.fn(),
  resolveSessakuPieceItemKeys: async (_client: unknown, keys: string[]) => new Map([[keys[0], { fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10' }]])
}));
vi.mock('../piece-audit.js', async () => ({ pieceTimingStage: new (await import('node:async_hooks')).AsyncLocalStorage(), readLaterPieceAuditSnapshots: async () => [], collectLaterPiecePropagationAudits: () => [],
  runSessakuPieceOperation: async (audit: unknown, callback: (audit: unknown) => unknown) => callback(audit) }));
vi.mock('../piece-completion.js', () => ({ reconcileSessakuPieceProgress: mocks.progress }));
vi.mock('../piece-quantity.js', () => ({ reconcileSessakuPieceQuantities: mocks.quantities }));
vi.mock('../../policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: async () => ({}), isProductionScheduleCuttingResourceCd: () => true }));
vi.mock('../../fkojunst-status-mail-critical-lock.js', () => ({ acquireFkojunstStatusMailCriticalTransactionLock: vi.fn() }));
vi.mock('../../order-assignment/production-schedule-parent-row-lock.service.js', () => ({ acquireProductionScheduleParentRowLockInTransaction: vi.fn() }));
import { setSessakuPieceCompletion, setSessakuPieceOpCompletion, splitSessakuPieces, mergeSessakuPieces } from '../sessaku-pieces.service.js';
import { projectGrindingPlanningBoard } from '../../grinding-planning-board-projection.js';
import { encodeSessakuPieceKey, sessakuPieceParentItemId } from '../piece-key.js';

const key = { fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10' };
const row = { id: 'row', rowData: { FSEIBAN: 'S', FHINCD: 'PART', FSIGENCD: '021', FKOJUN: '10', ProductNo: '1', FSIGENSHOYORYO: '10' }, updatedAt: null };
let set: SessakuPieceSet;
let definitions: { opNo: number }[];
let completed: Set<number>;
let detail: GrindingPlanningBoardProjectionRowDetail;
const projection = () => projectGrindingPlanningBoard({ rows: [row], details: new Map([['row', detail]]), overrides: new Map(),
  pieceSets: new Map([[encodeSessakuPieceKey(key), set]]), ranks: { rows: new Map() }, category: 'all', view: 'resource', seibanOrder: ['S'], includePieces: true });
const apply = (opNo: number, intent: 'complete' | 'incomplete' = 'complete', audit?: PieceAuditContext) => {
  const item = projection().items[0];
  return setSessakuPieceOpCompletion({ siteKey: 'site', pieceId: set.pieces[0].id, opNo, intent,
    expectedPieceSetVersion: set.version, itemRevision: item.itemRevision, audit });
};

describe('piece operation completion transaction', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.resetAllMocks(); completed = new Set(); definitions = [{ opNo: 1 }, { opNo: 2 }];
    const now = new Date('2026-11-09');
    set = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 1, nextPosition: 2, plannedQuantity: 1, quantityWarning: null,
      sourcePieceSetId: null, createdAt: now, updatedAt: now, pieces: [{ id: randomUUID(), pieceSetId: 'set', quantity: 1, position: 1,
        sourcePieceId: null, isCompleted: false, completedAt: null, createdAt: now, updatedAt: now, opCompletions: [] }] };
    detail = { updatedAt: null, rowNotes: [], orderSupplements: [{ plannedQuantity: 1, plannedEndDate: null }],
      productionScheduleProgress: null, productionScheduleExternalCompletion: null };
    mocks.tx.productionScheduleSessakuPieceHistory.findUnique.mockResolvedValue(null);
    mocks.tx.productionScheduleSessakuPieceSet.findUnique.mockResolvedValue(null);
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst.mockResolvedValue(null);
    mocks.rows.mockResolvedValue([row]); mocks.details.mockImplementation(async () => new Map([['row', detail]]));
    mocks.readSet.mockImplementation(async () => set); mocks.sets.mockImplementation(async () => new Map([[encodeSessakuPieceKey(key), set]]));
    mocks.winner.mockResolvedValue(row); mocks.logicalLocks.mockResolvedValue(new Set([encodeSessakuPieceKey(key)]));
    mocks.transaction.mockImplementation((callback) => callback(mocks.tx));
    mocks.tx.$queryRaw.mockImplementation(async (strings) => String(strings).includes('FOR SHARE') ? [{ id: 'part' }] : []);
    for (const table of [mocks.tx.productionScheduleOrderAssignment, mocks.tx.productionScheduleGrindingPlanningBoardOverride, mocks.tx.productionScheduleSessakuPieceSet,
      mocks.tx.productionScheduleGrindingPlanningBoardResourceCapacity, mocks.tx.productionScheduleGrindingPlanningBoardResourceMinutesSource,
      mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes]) table.findMany.mockResolvedValue([]);
    mocks.tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'site', seibanOrder: ['S'] }]);
    mocks.tx.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow.mockResolvedValue({ seibanOrder: ['S'] });
    mocks.tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.findMany.mockImplementation(async () => definitions);
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findMany.mockImplementation(async () => [...completed].map((opNo) => ({ opNo })));
    mocks.tx.productionScheduleSessakuPieceOpCompletion.upsert.mockImplementation(async ({ create }) => { completed.add(create.opNo); });
    mocks.tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mockImplementation(async ({ where }) => { if (where.opNo === undefined) { const count = completed.size; completed.clear(); return { count }; }
      return { count: Number(completed.delete(where.opNo)) }; });
    mocks.tx.productionScheduleSessakuPieceOpCompletion.createMany.mockImplementation(async ({ data }) => {
      const before = completed.size; data.forEach((op: { opNo: number }) => completed.add(op.opNo)); return { count: completed.size - before };
    });
    mocks.tx.productionScheduleSessakuPiece.update.mockImplementation(async ({ data }) => { Object.assign(set.pieces[0], data); });
    mocks.tx.productionScheduleSessakuPieceSet.update.mockImplementation(async () => { set.version += 1; });
    mocks.progress.mockImplementation(async () => ({ parentIsCompleted: set.pieces.every((piece) => piece.isCompleted) }));
  });
  it.each(['resource off', 'quantity outside range', 'predecessor'])(
    'distinguishes temporary eligibility from structural eligibility under the lot lock: %s', async (reason) => {
      vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
      mocks.readSet.mockResolvedValue(null); mocks.sets.mockResolvedValue(new Map());
      detail.orderSupplements[0].plannedQuantity = reason === 'quantity outside range' ? 1 : 2;
      if (reason === 'resource off') mocks.tx.productionScheduleGrindingPlanningBoardResourceCapacity.findMany
        .mockResolvedValue([{ resourceCd: '021', unitSplitEnabled: false, dailyHours: 8, runsThroughBreaks: false }]);
      if (reason === 'predecessor') {
        const earlier = { ...row, id: 'earlier', rowData: { ...row.rowData, FKOJUN: '1' } };
        mocks.rows.mockResolvedValue([row, earlier]);
        mocks.details.mockImplementation(async () => new Map([['row', detail], ['earlier', detail]]));
      }
      await expect(splitSessakuPieces({ siteKey: 'site', parentItemId: sessakuPieceParentItemId(key),
        expectedPieceSetVersion: 0, itemRevision: 'unused-for-auto', quantities: [1, 1], autoUnitSplit: true }))
        .rejects.toMatchObject({ statusCode: 409, code: reason === 'predecessor'
          ? 'AUTO_UNIT_SPLIT_STRUCTURALLY_INELIGIBLE' : 'AUTO_UNIT_SPLIT_INELIGIBLE' });
      expect(mocks.tx.productionScheduleSessakuPieceHistory.upsert).not.toHaveBeenCalled();
      expect(mocks.tx.productionScheduleSessakuPieceSet.update).not.toHaveBeenCalled();
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
    });
  it.each([
    { code: 'P2028' },
    { code: 'P2010', meta: { code: '57014' } },
    { code: 'P2010', meta: { code: '55P03' } }
  ])('never writes manual history during an auto split that fails with %j', async (failure) => {
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    mocks.readSet.mockResolvedValue(null); mocks.sets.mockResolvedValue(new Map());
    detail.orderSupplements[0].plannedQuantity = 2;
    vi.spyOn(performance, 'now').mockReturnValue(1250);
    // Fail immediately after the former history write, inside the real split action.
    mocks.tx.productionScheduleSessakuPieceSet.create.mockRejectedValue(failure);
    await expect(splitSessakuPieces({ siteKey: 'site', parentItemId: sessakuPieceParentItemId(key),
      expectedPieceSetVersion: 0, itemRevision: 'unused-for-auto', quantities: [1, 1], autoUnitSplit: true,
      deadline: 4250 })).rejects.toMatchObject({ code: 'AUTO_UNIT_SPLIT_BUSY' });
    expect(mocks.tx.productionScheduleSessakuPieceHistory.upsert).not.toHaveBeenCalled();
    const options = mocks.transaction.mock.calls[0][1];
    expect(options.timeout).toBe(3000);
    expect(options.maxWait).toBe(250);
    expect(mocks.tx.$queryRaw).toHaveBeenCalledWith(expect.any(Array), '250ms', `${options.timeout}ms`);
  });
  it('cancels an in-flight callback as soon as Prisma rejects its transaction, before the deadline', async () => {
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    mocks.readSet.mockResolvedValue(null); mocks.sets.mockResolvedValue(new Map());
    detail.orderSupplements[0].plannedQuantity = 2;
    let resume!: (value: unknown) => void;
    let rejectTransaction!: (error: unknown) => void;
    let callback!: Promise<unknown>;
    mocks.tx.productionScheduleSessakuPieceSet.create.mockReturnValue(new Promise((resolve) => { resume = resolve; }));
    mocks.transaction.mockImplementationOnce((work) => {
      callback = work(mocks.tx);
      void callback.catch(() => undefined);
      return new Promise((_, reject) => { rejectTransaction = reject; });
    });
    const result = expect(splitSessakuPieces({ siteKey: 'site', parentItemId: sessakuPieceParentItemId(key),
      expectedPieceSetVersion: 0, itemRevision: 'unused-for-auto', quantities: [1, 1], autoUnitSplit: true,
      deadline: performance.now() + 3000 })).rejects.toMatchObject({ code: 'AUTO_UNIT_SPLIT_BUSY' });
    await vi.waitFor(() => expect(mocks.tx.productionScheduleSessakuPieceSet.create).toHaveBeenCalledTimes(1));
    rejectTransaction({ code: 'P2028' });
    await result;
    resume({ id: 'expired-set' });
    await expect(callback).rejects.toMatchObject({ code: 'AUTO_UNIT_SPLIT_BUDGET' });
    expect(mocks.tx.productionScheduleSessakuPieceHistory.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPiece.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPieceSet.update).not.toHaveBeenCalled();
  });
  it('completes the piece only after every configured operation, reconciles parent progress, and reopens it on undo', async () => {
    const first = await apply(1);
    expect(first.parentIsCompleted).toBe(false); expect(set.pieces[0].isCompleted).toBe(false); expect(set.version).toBe(2);
    const second = await apply(2);
    expect(set.pieces[0].isCompleted).toBe(true); expect(second.parentIsCompleted).toBe(true); expect(set.version).toBe(3);
    const third = await apply(1, 'incomplete');
    expect(set.pieces[0].isCompleted).toBe(false); expect(third.parentIsCompleted).toBe(false);
    expect(mocks.quantities).toHaveBeenCalledTimes(3); expect(mocks.progress).toHaveBeenCalledTimes(3);
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
  });
  it('does not reopen an already completed piece when completing one operation', async () => {
    set.pieces[0].isCompleted = true;
    await apply(1); expect(set.pieces[0].isCompleted).toBe(true);
    await apply(1, 'incomplete'); expect(set.pieces[0].isCompleted).toBe(false);
  });
  it('synchronizes every operation with whole-piece completion and undo', async () => {
    const direct = async (intent: 'complete' | 'incomplete') => {
      const item = projection().items[0];
      return setSessakuPieceCompletion({ siteKey: 'site', pieceId: item.pieceId!, expectedPieceSetVersion: set.version, itemRevision: item.itemRevision, intent });
    };
    await direct('complete'); expect([...completed]).toEqual([1, 2]); expect(set.pieces[0].isCompleted).toBe(true);
    await direct('incomplete'); expect([...completed]).toEqual([]); expect(set.pieces[0].isCompleted).toBe(false);
  });
  it('preserves partial operations and the version on a repeated whole-piece incomplete intent', async () => {
    await apply(1);
    const item = projection().items[0];
    const version = set.version;
    await setSessakuPieceCompletion({ siteKey: 'site', pieceId: item.pieceId!, expectedPieceSetVersion: version,
      itemRevision: item.itemRevision, intent: 'incomplete' });
    expect([...completed]).toEqual([1]);
    expect(set.pieces[0].isCompleted).toBe(false);
    expect(set.version).toBe(version);
    expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.deleteMany).not.toHaveBeenCalled();
  });
  it('returns STALE_SESSAKU_PIECES when a stored piece is missing from the projection', async () => {
    const item = projection().items[0];
    mocks.details.mockResolvedValue(new Map());
    await expect(setSessakuPieceCompletion({ siteKey: 'site', pieceId: item.pieceId!, expectedPieceSetVersion: set.version,
      itemRevision: item.itemRevision, intent: 'complete' })).rejects.toMatchObject({ statusCode: 409, code: 'STALE_SESSAKU_PIECES' });
    expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPiece.update).not.toHaveBeenCalled();
  });
  it.each(['split', 'merge'])('rejects %s when an affected piece has an operation record', async (operation) => {
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    set.pieces[0].quantity = 2; set.plannedQuantity = 3; detail.orderSupplements[0].plannedQuantity = 3;
    set.pieces.push({ ...set.pieces[0], id: randomUUID(), position: 2, quantity: 1 });
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst.mockResolvedValue({ pieceId: set.pieces[0].id });
    const items = projection().items;
    const request = { siteKey: 'site', parentItemId: items[0].parentItemId!, expectedPieceSetVersion: set.version };
    await expect(operation === 'split'
      ? splitSessakuPieces({ ...request, targetPieceId: items[0].pieceId!, itemRevision: items[0].itemRevision, quantities: [1, 1] })
      : mergeSessakuPieces({ ...request, pieceIds: items.map((i) => i.pieceId!), itemRevisions: Object.fromEntries(items.map((i) => [i.itemId, i.itemRevision])) }))
      .rejects.toMatchObject({ statusCode: 409, code: 'PIECE_OPERATION_COMPLETED' });
  });
  it('records operation before/after evidence in the audit context', async () => {
    const audit: PieceAuditContext = { action: 'op_complete' };
    await apply(1, 'complete', audit);
    expect(audit.beforeJson).toMatchObject({ opNo: 1, completedOpNos: [] });
    expect(audit.afterJson).toMatchObject({ opNo: 1, completedOpNos: [1] });
  });
  it.each([[], [{ opNo: 2 }]])('rejects an unregistered operation without a write: %j', async (...ops) => {
    definitions = ops;
    await expect(apply(1)).rejects.toMatchObject({ statusCode: 400, code: 'PIECE_OPERATION_NOT_CONFIGURED' });
    expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.upsert).not.toHaveBeenCalled();
  });
  it('rejects stale version/revision before changing operation records', async () => {
    const original = projection().items[0]; await apply(1);
    await expect(setSessakuPieceOpCompletion({ siteKey: 'site', pieceId: set.pieces[0].id, opNo: 2,
      intent: 'complete', expectedPieceSetVersion: 1, itemRevision: original.itemRevision })).rejects.toMatchObject({ statusCode: 409 });
    await expect(setSessakuPieceOpCompletion({ siteKey: 'site', pieceId: set.pieces[0].id, opNo: 2,
      intent: 'complete', expectedPieceSetVersion: set.version, itemRevision: '0'.repeat(64) })).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.upsert).toHaveBeenCalledTimes(1);
  });
  it('does not increment the version for an unchanged operation', async () => {
    await apply(1); const version = set.version; await apply(1); expect(set.version).toBe(version);
  });
  it('rejects undo of externally completed work', async () => {
    detail.productionScheduleExternalCompletion = { isExternallyCompleted: true, updatedAt: new Date() };
    await expect(apply(1, 'incomplete')).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.deleteMany).not.toHaveBeenCalled();
  });
  it.each(['55P03', '57014'])('maps native/PG adapter SQLSTATE %s to AUTO_UNIT_SPLIT_BUSY', async (code) => {
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    const item = projection().items[0];
    for (const meta of [{ code }, { driverAdapterError: { cause: { originalCode: code } } }]) {
      mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('lock wait cancelled'), { code: 'P2010', meta }));
      await expect(splitSessakuPieces({ siteKey: 'site', parentItemId: item.parentItemId!, expectedPieceSetVersion: 0,
        itemRevision: item.itemRevision, quantities: [1, 1], autoUnitSplit: true }))
        .rejects.toMatchObject({ statusCode: 409, code: 'AUTO_UNIT_SPLIT_BUSY' });
    }
  });
  it('rejects a concurrently changed version under the logical lock', async () => {
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    await expect(splitSessakuPieces({ siteKey: 'site', parentItemId: sessakuPieceParentItemId(key), expectedPieceSetVersion: 0,
      itemRevision: 'unused-for-auto', quantities: [1, 1], autoUnitSplit: true })).rejects.toMatchObject({ code: 'STALE_SESSAKU_PIECES' });
    expect(mocks.logicalLocks).toHaveBeenCalledTimes(1);
    expect(mocks.tx.productionScheduleSessakuPieceHistory.findUnique).not.toHaveBeenCalled();
  });
});
