import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { SessakuPieceSet } from '../piece-key.js';

const mocks = vi.hoisted(() => ({ critical: vi.fn(), logical: vi.fn(), board: vi.fn(), rowLock: vi.fn(),
  quantities: vi.fn(), progress: vi.fn(), rows: vi.fn(), details: vi.fn(), overrides: vi.fn(), overrideSites: vi.fn() }));
vi.mock('../../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../piece-quantity.js', () => ({ reconcileSessakuPieceQuantities: mocks.quantities }));
vi.mock('../piece-completion.js', () => ({ reconcileSessakuPieceProgress: mocks.progress }));
vi.mock('../../fkojunst-status-mail-critical-lock.js', () => ({ acquireFkojunstStatusMailCriticalTransactionLock: mocks.critical }));
vi.mock('../../order-assignment/production-schedule-parent-row-lock.service.js', () => ({ acquireProductionScheduleParentRowLocksInTransaction: mocks.rowLock }));
vi.mock('../../grinding-planning-board/source.js', () => ({ readOverrides: mocks.overrides, readRowDetails: mocks.details, readWinnerRowsByLogicalKeyFseibans: mocks.rows }));
vi.mock('../piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../piece-key.js')>(),
  acquireSessakuPieceLogicalLocks: mocks.logical, acquireSessakuPieceBoardStateLocks: mocks.board
}));
import { lockOperationDefinitionPieces, reconcileOperationDefinitionPieces, syncWholePiecesOperationCompletions } from '../piece-operation-definitions.js';
import { encodeSessakuPieceKey, sessakuPieceParentItemId } from '../piece-key.js';

const key = { fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10' };
const row = { id: 'row', rowData: { FSEIBAN: 'S', FHINCD: 'PART', FSIGENCD: '021', FKOJUN: '10' } };
const tx = {
  $queryRaw: vi.fn(), productionScheduleSessakuPiece: { update: vi.fn(), updateMany: vi.fn() },
  productionScheduleGrindingPlanningBoardResourcePartMinutes: { findMany: vi.fn() },
  productionScheduleGrindingPlanningBoardResourcePartOpMinutes: { findMany: vi.fn() },
  productionScheduleGrindingPlanningBoardState: { findMany: vi.fn() },
  productionScheduleGrindingPlanningBoardOverride: { findMany: mocks.overrides, groupBy: mocks.overrideSites },
  productionScheduleSessakuPieceSet: { findMany: vi.fn(), updateMany: vi.fn() },
  productionScheduleSessakuPieceOpCompletion: { deleteMany: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  site: { findMany: vi.fn() }
};
const client = tx as unknown as Prisma.TransactionClient;
let set: SessakuPieceSet;
let records: { pieceId: string; opNo: number }[];
let external: boolean;
const reconcile = (opNos: number[]) => reconcileOperationDefinitionPieces(client, { siteKey: 'site', resourceCd: '021' }, [key], opNos);

beforeEach(() => {
  vi.resetAllMocks(); external = false; records = [{ pieceId: 'p', opNo: 1 }];
  const now = new Date(0);
  set = { id: 'set', ...key, csvDashboardId: 'd', version: 1, nextPosition: 2, plannedQuantity: 1, quantityWarning: null, sourcePieceSetId: null,
    createdAt: now, updatedAt: now, pieces: [{ id: 'p', pieceSetId: 'set', position: 1, quantity: 1, sourcePieceId: null, isCompleted: false,
      completedAt: null, createdAt: now, updatedAt: now }] };
  tx.productionScheduleSessakuPieceSet.findMany.mockImplementation(async () => [set]);
  tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'site', seibanOrder: ['S'] }]);
  tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([]);
  mocks.rows.mockResolvedValue([row]); mocks.logical.mockResolvedValue(new Set([encodeSessakuPieceKey(key)]));
  mocks.overrides.mockResolvedValue([]);
  mocks.overrideSites.mockResolvedValue(['site', 'other', 'third'].map((siteKey) => ({ siteKey })));
  tx.site.findMany.mockResolvedValue([]);
  mocks.details.mockImplementation(async () => new Map([['row', { orderSupplements: [], productionScheduleExternalCompletion: { isExternallyCompleted: external } }]]));
  tx.productionScheduleSessakuPieceOpCompletion.findMany.mockImplementation(async ({ where }) => records.filter((record) => where.pieceId.in.includes(record.pieceId)
    && !(where.opNo?.notIn.includes(record.opNo) ?? false)));
  tx.productionScheduleSessakuPieceOpCompletion.createMany.mockImplementation(async ({ data }) => { records.push(...data); return { count: data.length }; });
  tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mockImplementation(async ({ where }) => {
    const count = records.length;
    records = records.filter((record) => !where.pieceId.in.includes(record.pieceId) || (where.opNo?.notIn.includes(record.opNo) ?? false));
    return { count: count - records.length };
  });
});

describe('operation definition replacement', () => {
  it('uses the piece edit lock order before a definition can be written', async () => {
    tx.$queryRaw.mockResolvedValueOnce([key]).mockResolvedValue([]);
    expect(await lockOperationDefinitionPieces(client, '\tPART\u3000')).toEqual([key]);
    const calls = [mocks.critical, mocks.logical, mocks.board, mocks.rowLock].map((fn) => fn.mock.invocationCallOrder[0]);
    expect(calls).toEqual([...calls].sort((a, b) => a - b));
    expect(mocks.rowLock).toHaveBeenCalledWith(client, ['row']);
    expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeGreaterThan(calls[3]);
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toContain('PART');
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toEqual(expect.arrayContaining([expect.stringContaining('\u3000')]));
  });
  it('locks all matching parent rows in sorted order with one row-lock statement', async () => {
    tx.$queryRaw.mockResolvedValueOnce([key]).mockResolvedValue([]);
    mocks.rows.mockResolvedValue([{ ...row, id: 'z' }, { ...row, id: 'a' },
      { id: 'ignored', rowData: { ...row.rowData, FHINCD: 'OTHER' } }]);
    await lockOperationDefinitionPieces(client, 'PART');
    expect(mocks.rowLock).toHaveBeenCalledExactlyOnceWith(client, ['a', 'z']);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls[1][0].join('')).toContain('= ANY(::text[]) ORDER BY "id" FOR UPDATE');
    expect(tx.$queryRaw.mock.calls[1][1]).toEqual(['a', 'z']);
  });
  it('takes no piece locks when the part has no sets', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await lockOperationDefinitionPieces(client, 'PART')).toEqual([]);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).not.toContain('BTRIM("fseiban"');
    expect(mocks.logical).not.toHaveBeenCalled(); expect(mocks.board).not.toHaveBeenCalled();
  });
  it('locks off-board keys even when no site displays any seiban', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'site', seibanOrder: [] }]);
    tx.$queryRaw.mockResolvedValueOnce([key]).mockResolvedValue([]);
    expect(await lockOperationDefinitionPieces(client, 'PART')).toEqual([key]);
    expect(mocks.logical).toHaveBeenCalledExactlyOnceWith(client, [key]);
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(mocks.rowLock).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('locks all logical keys together but reads winners and locks parents only for displayed seibans', async () => {
    const offBoard = { ...key, fseiban: 'OFF' };
    const displayed = { ...key, fseiban: '\tS\u3000' };
    const keys = [offBoard, displayed];
    tx.$queryRaw.mockResolvedValueOnce(keys).mockResolvedValue([]);
    mocks.logical.mockResolvedValue(new Set(keys.map(encodeSessakuPieceKey)));
    mocks.rows.mockResolvedValue([{ ...row, rowData: { ...row.rowData, FSEIBAN: displayed.fseiban } }]);
    expect(await lockOperationDefinitionPieces(client, 'PART')).toEqual(keys);
    expect(mocks.logical).toHaveBeenCalledExactlyOnceWith(client, keys);
    expect(mocks.rows).toHaveBeenCalledExactlyOnceWith(client, [displayed.fseiban]);
    expect(mocks.rowLock).toHaveBeenCalledExactlyOnceWith(client, ['row']);
  });
  it('reads winners and details only for displayed seibans when reconciling mixed keys', async () => {
    const offBoard = { ...set, id: 'off', fseiban: 'OFF', pieces: [{ ...set.pieces[0], id: 'off-p', pieceSetId: 'off' }] };
    tx.productionScheduleSessakuPieceSet.findMany.mockResolvedValue([set, offBoard]);
    records.push({ pieceId: 'off-p', opNo: 2 });
    await reconcileOperationDefinitionPieces(client, { siteKey: 'site', resourceCd: '021' }, [key, offBoard], [1, 3]);
    expect(mocks.rows).toHaveBeenCalledExactlyOnceWith(client, ['S']);
    expect(mocks.details).toHaveBeenCalledExactlyOnceWith(client, ['row']);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.findMany.mock.calls).toEqual([
      [{ where: { pieceId: { in: ['p'] } }, select: { pieceId: true, opNo: true } }],
      [{ where: { pieceId: { in: ['off-p'] }, opNo: { notIn: [1, 3] } }, select: { pieceId: true } }]
    ]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mock.calls).toEqual([
      [{ where: { pieceId: { in: ['p'] }, opNo: { notIn: [1, 3] } } }],
      [{ where: { pieceId: { in: ['off-p'] }, opNo: { notIn: [1, 3] } } }]
    ]);
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['set', 'off'] } }, data: { version: { increment: 1 } }
    });
  });
  it('retains operation numbers defined at another site and fills only the saving site', async () => {
    set.pieces[0].isCompleted = true;
    records = [{ pieceId: 'p', opNo: 1 }, { pieceId: 'p', opNo: 9 }];
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'other', resourceCd: '022', fhincd: 'PART', ops: [{ opNo: 1 }, { opNo: 3 }] }
    ]);
    mocks.overrides.mockResolvedValue([{ siteKey: 'other', itemKey: 'piece:p', overrideResourceCd: '022' }]);
    await reconcile([2]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }, { pieceId: 'p', opNo: 2 }]);
  });
  it('does not fill saving-site operations for a piece matching that resource only elsewhere', async () => {
    set.pieces[0].isCompleted = true;
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([
      { siteKey: 'site', seibanOrder: ['S'] }, { siteKey: 'other', seibanOrder: ['S'] }
    ]);
    mocks.overrides.mockResolvedValue([{ siteKey: 'site', itemKey: 'piece:p', overrideResourceCd: '022' }]);
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'other', resourceCd: '021', fhincd: 'PART', ops: [{ opNo: 1 }] }
    ]);
    await reconcile([2]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
  });
  it('completes a piece once every retained operation is recorded and synchronizes parent/later progress', async () => {
    records.push({ pieceId: 'p', opNo: 3 }); await reconcile([1]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPiece.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['p'] } }, data: { isCompleted: true, completedAt: expect.any(Date) }
    });
    expect(mocks.quantities).toHaveBeenCalledExactlyOnceWith(client, set, 1);
    expect(mocks.progress).toHaveBeenCalledExactlyOnceWith(client, set, { emptyIsIncomplete: true });
  });
  it('does not complete a piece with a remaining missing operation', async () => {
    await reconcile([1, 2]);
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    expect(mocks.progress).not.toHaveBeenCalled();
  });
  it('requires the retained operations from other resources/sites too', async () => {
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'other', resourceCd: '021', fhincd: 'PART', ops: [{ opNo: 2 }] }
    ]);
    await reconcile([1]);
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    expect(mocks.progress).not.toHaveBeenCalled();
  });
  it('keeps a completed piece closed and fills newly added operation evidence', async () => {
    set.pieces[0].isCompleted = true; const before = { ...set.pieces[0] }; await reconcile([1, 2]);
    expect(set.pieces[0]).toEqual(before); expect(records).toEqual([{ pieceId: 'p', opNo: 1 }, { pieceId: 'p', opNo: 2 }]);
    expect(tx.productionScheduleSessakuPiece.update).not.toHaveBeenCalled();
  });
  it.each([true, false])('preserves completion=%s when the definition is emptied', async (isCompleted) => {
    set.pieces[0].isCompleted = isCompleted; await reconcile([]);
    expect(records).toEqual([]); expect(set.pieces[0].isCompleted).toBe(isCompleted);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { pieceId: { in: ['p'] } } });
    expect(tx.productionScheduleSessakuPiece.update).not.toHaveBeenCalled();
  });
  it('only deletes removed operations on externally completed pieces', async () => {
    external = true; await reconcile([2]);
    expect(records).toEqual([]);
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
  });
  it('matches effective resource, with an own override replacing parent inheritance', async () => {
    mocks.overrides.mockResolvedValue([{ siteKey: 'site', itemKey: sessakuPieceParentItemId(key), overrideResourceCd: '021' }, { siteKey: 'site', itemKey: 'piece:p', overrideResourceCd: '022' }]);
    records.push({ pieceId: 'p', opNo: 2 });
    await reconcile([2]); expect(records).toEqual([{ pieceId: 'p', opNo: 2 }]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { pieceId: { in: ['p'] }, opNo: { notIn: [2] } }, select: { pieceId: true }
    });
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['set'] } }, data: { version: { increment: 1 } }
    });
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    records = [{ pieceId: 'p', opNo: 1 }];
    mocks.overrides.mockResolvedValue([{ siteKey: 'site', itemKey: sessakuPieceParentItemId(key), overrideResourceCd: '022' }, { siteKey: 'site', itemKey: 'piece:p', overrideResourceCd: '021' }]);
    await reconcile([2]); expect(records).toEqual([]); expect(set.pieces[0].isCompleted).toBe(false);
  });
  it('deletes removed operations off-board using the replacement instead of the stored definition', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'site', seibanOrder: ['OTHER'] }]);
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'site', resourceCd: '021', fhincd: 'PART', ops: [{ opNo: 1 }, { opNo: 2 }] }
    ]);
    records.push({ pieceId: 'p', opNo: 2 });
    await reconcile([1]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['set'] } }, data: { version: { increment: 1 } }
    });
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    expect(mocks.quantities).not.toHaveBeenCalled();
    expect(mocks.progress).not.toHaveBeenCalled();
  });
  it.each([false, true])('deletes obsolete off-board evidence after an override moves 021 to undefined resource 022 (completed=%s)', async (isCompleted) => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    set.pieces[0].isCompleted = isCompleted;
    const before = { ...set.pieces[0] };
    mocks.overrides.mockResolvedValue([{ siteKey: 'site', itemKey: 'piece:p', overrideResourceCd: '022' }]);
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'site', resourceCd: '021', fhincd: 'PART', ops: [{ opNo: 1 }, { opNo: 2 }] }
    ]);
    records.push({ pieceId: 'p', opNo: 2 });
    await reconcile([1, 3]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    const where = { pieceId: { in: ['p'] }, opNo: { notIn: [1, 3] } };
    expect(tx.productionScheduleSessakuPieceOpCompletion.findMany).toHaveBeenCalledExactlyOnceWith({ where, select: { pieceId: true } });
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).toHaveBeenCalledExactlyOnceWith({ where });
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['set'] } }, data: { version: { increment: 1 } }
    });
    expect(set.pieces[0]).toEqual(before);
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    expect(mocks.quantities).not.toHaveBeenCalled();
    expect(mocks.progress).not.toHaveBeenCalled();
  });
  it('does not retain off-board 021 evidence merely because unrelated resource 022 defines the number', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'site', resourceCd: '021', fhincd: 'PART', ops: [{ opNo: 1 }, { opNo: 2 }] },
      { siteKey: 'other', resourceCd: '022', fhincd: 'PART', ops: [{ opNo: 2 }] }
    ]);
    records.push({ pieceId: 'p', opNo: 2 });
    await reconcile([1]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { pieceId: { in: ['p'] }, opNo: { notIn: [1] } }
    });
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['set'] } }, data: { version: { increment: 1 } }
    });
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
  });
  it.each([false, true])('leaves a delete-only set unchanged when no obsolete records exist (completed=%s)', async (isCompleted) => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    set.pieces[0].isCompleted = isCompleted;
    const before = structuredClone(set);
    await reconcile([1, 3]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { pieceId: { in: ['p'] }, opNo: { notIn: [1, 3] } }, select: { pieceId: true }
    });
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(set).toEqual(before);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPieceSet.updateMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    expect(mocks.quantities).not.toHaveBeenCalled();
    expect(mocks.progress).not.toHaveBeenCalled();
  });
  it.each(['021', '022'])('retains off-board evidence from another site/resource %s in the effective-resource union', async (resourceCd) => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    mocks.overrides.mockResolvedValue([
      { siteKey: 'other', itemKey: 'piece:p', overrideResourceCd: '022' }
    ]);
    // The third site itself uses 021. A 022 definition still belongs to the union.
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'third', resourceCd, fhincd: 'PART', ops: [{ opNo: 2 }] },
      { siteKey: 'third', resourceCd: '023', fhincd: 'PART', ops: [{ opNo: 3 }] },
      { siteKey: 'third', resourceCd, fhincd: 'OTHER', ops: [{ opNo: 4 }] }
    ]);
    records = [1, 2, 3, 4].map((opNo) => ({ pieceId: 'p', opNo }));
    await reconcile([1]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }, { pieceId: 'p', opNo: 2 }]);
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
  });
  it.each([true, false])('only deletes off-board evidence with completion=%s', async (isCompleted) => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    set.pieces[0].isCompleted = isCompleted;
    const before = { ...set.pieces[0] };
    records.push({ pieceId: 'p', opNo: 2 });
    await reconcile(isCompleted ? [1, 3] : [1]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(set.pieces[0]).toEqual(before);
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    const where = { pieceId: { in: ['p'] }, opNo: { notIn: isCompleted ? [1, 3] : [1] } };
    expect(tx.productionScheduleSessakuPieceOpCompletion.findMany).toHaveBeenCalledExactlyOnceWith({ where, select: { pieceId: true } });
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).toHaveBeenCalledExactlyOnceWith({ where });
    expect(tx.productionScheduleSessakuPieceOpCompletion.findMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mock.invocationCallOrder[0]);
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['set'] } }, data: { version: { increment: 1 } }
    });
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    expect(mocks.progress).not.toHaveBeenCalled();
  });
  it.each([null, '022'])('resolves an off-board own override %s before the parent and base resource', async (ownResource) => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    mocks.overrides.mockResolvedValue([
      { siteKey: 'other', itemKey: sessakuPieceParentItemId(key), overrideResourceCd: '023' },
      { siteKey: 'other', itemKey: 'piece:p', overrideResourceCd: ownResource }
    ]);
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'site', resourceCd: '022', fhincd: 'PART', ops: [{ opNo: 1 }] },
      { siteKey: 'site', resourceCd: '023', fhincd: 'PART', ops: [{ opNo: 3 }] }
    ]);
    records.push({ pieceId: 'p', opNo: 3 });
    await reconcile([2]);
    expect(records).toEqual(ownResource === null ? [] : [{ pieceId: 'p', opNo: 1 }]);
  });
  it('inherits off-board parent overrides at sites with no board state', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    mocks.overrides.mockResolvedValue([
      { siteKey: 'other', itemKey: sessakuPieceParentItemId(key), overrideResourceCd: '022' }
    ]);
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'site', resourceCd: '022', fhincd: 'PART', ops: [{ opNo: 1 }] }
    ]);
    await reconcile([2]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
  });
  it.each(['external', 'missing winner'])('deletes obsolete off-board evidence without consulting %s', async (reason) => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    external = reason === 'external';
    if (reason === 'missing winner') mocks.rows.mockResolvedValue([]);
    records.push({ pieceId: 'p', opNo: 2 });
    await reconcile([1]);
    await reconcile([1, 2]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(mocks.details).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPieceOpCompletion.findMany.mock.calls).toEqual([
      [{ where: { pieceId: { in: ['p'] }, opNo: { notIn: [1] } }, select: { pieceId: true } }],
      [{ where: { pieceId: { in: ['p'] }, opNo: { notIn: [1, 2] } }, select: { pieceId: true } }]
    ]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { pieceId: { in: ['p'] }, opNo: { notIn: [1] } }
    });
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['set'] } }, data: { version: { increment: 1 } }
    });
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
  });
  it('only deletes removed operations on on-board pieces without a winner', async () => {
    mocks.rows.mockResolvedValue([]);
    await reconcile([]);
    expect(records).toEqual([]);
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
  });
  it('bounds off-board set/override reads and deletions to batches of 300', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([]);
    const sets = Array.from({ length: 601 }, (_, i) => ({ ...set, id: `set${i}`, fseiban: `S${i}`,
      pieces: [{ ...set.pieces[0], id: `p${i}`, pieceSetId: `set${i}` }] }));
    tx.productionScheduleSessakuPieceSet.findMany.mockImplementation(async ({ where }) =>
      sets.filter((set) => where.OR.some((key: { fseiban: string }) => key.fseiban === set.fseiban)));
    mocks.rows.mockResolvedValue(sets.map((set) => ({ ...row, id: `row${set.id}`, rowData: { ...row.rowData, FSEIBAN: set.fseiban } })));
    records = sets.flatMap((set) => [1, 2].map((opNo) => ({ pieceId: set.pieces[0].id, opNo })));
    await reconcileOperationDefinitionPieces(client, { siteKey: 'site', resourceCd: '021' }, sets, [1]);
    expect(records).toEqual(sets.map((set) => ({ pieceId: set.pieces[0].id, opNo: 1 })));
    expect(tx.productionScheduleSessakuPieceSet.findMany.mock.calls.map(([{ where }]) => where.OR.length)).toEqual([300, 300, 1]);
    const chunked = mocks.overrides.mock.calls.map(([{ where }]) => where);
    expect(chunked.map((where) => where.itemKey.in.length)).toEqual([300, 300, 300, 300, 2]);
    expect(chunked.every((where) => where.siteKey.in.length === 3)).toBe(true);
    expect(mocks.overrideSites).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mock.calls.map(([{ where }]) => where.pieceId.in.length)).toEqual([300, 300, 1]);
    expect(tx.productionScheduleSessakuPieceSet.updateMany.mock.calls.map(([{ where }]) => where.id.in.length)).toEqual([300, 300, 1]);
    expect(mocks.rows).not.toHaveBeenCalled();
    expect(mocks.details).not.toHaveBeenCalled();
    const reads = tx.productionScheduleSessakuPieceOpCompletion.findMany.mock.calls;
    const deletes = tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mock.calls;
    expect(reads.map(([{ where }]) => where.pieceId.in.length)).toEqual([300, 300, 1]);
    expect(reads.flatMap(([{ where }]) => where.pieceId.in)).toEqual(sets.map((set) => set.pieces[0].id));
    reads.forEach(([query], index) => {
      expect(query.select).toEqual({ pieceId: true });
      expect(query.where.opNo).toEqual({ notIn: [1] });
      expect(deletes[index]).toEqual([{ where: query.where }]);
      expect(tx.productionScheduleSessakuPieceOpCompletion.findMany.mock.invocationCallOrder[index])
        .toBeLessThan(tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mock.invocationCallOrder[index]);
    });
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
  });
  it('uses other site overrides for cross-site operation records even outside the requesting board', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([
      { siteKey: 'site', seibanOrder: ['OTHER'] }, { siteKey: 'other', seibanOrder: ['S'] }
    ]);
    mocks.overrides.mockResolvedValue([
      { siteKey: 'site', itemKey: 'piece:p', overrideResourceCd: '022' },
      { siteKey: 'other', itemKey: sessakuPieceParentItemId(key), overrideResourceCd: '021' }
    ]);
    await reconcile([2]); expect(records).toEqual([]);
    expect(mocks.overrides.mock.calls[0][0].where.siteKey.in).toEqual(expect.arrayContaining(['site', 'other']));
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledTimes(1);
  });
  it('lets an own null resource suppress parent inheritance separately at each site', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'other', seibanOrder: ['S'] }]);
    mocks.overrides.mockResolvedValue([
      { siteKey: 'other', itemKey: sessakuPieceParentItemId(key), overrideResourceCd: '021' },
      { siteKey: 'other', itemKey: 'piece:p', overrideResourceCd: null }
    ]);
    set.fsigencd = '022';
    mocks.rows.mockResolvedValue([{ ...row, rowData: { ...row.rowData, FSIGENCD: '022' } }]);
    records.push({ pieceId: 'p', opNo: 2 });
    await reconcile([2]); expect(records).toEqual([{ pieceId: 'p', opNo: 2 }]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { pieceId: { in: ['p'] }, opNo: { notIn: [2] } }, select: { pieceId: true }
    });
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { pieceId: { in: ['p'] }, opNo: { notIn: [2] } }
    });
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['set'] } }, data: { version: { increment: 1 } }
    });
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPiece.updateMany).not.toHaveBeenCalled();
  });
  it('batches overrides/completions and deletes obsolete records once for 100 pieces', async () => {
    set.pieces = Array.from({ length: 100 }, (_, i) => ({ ...set.pieces[0], id: `p${i}`, isCompleted: true }));
    records = []; await reconcile([1, 2]);
    expect(records).toHaveLength(200);
    for (const fn of [mocks.overrides, tx.productionScheduleSessakuPieceOpCompletion.findMany,
      tx.productionScheduleSessakuPieceOpCompletion.deleteMany, tx.productionScheduleSessakuPieceOpCompletion.createMany,
      tx.productionScheduleSessakuPieceSet.updateMany]) expect(fn).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleSessakuPiece.update).not.toHaveBeenCalled();
  });
  it('increments every affected set once in batches of at most 300', async () => {
    const sets = Array.from({ length: 601 }, (_, i) => ({ ...set, id: `set${i}`,
      pieces: [{ ...set.pieces[0], id: `p${i}`, pieceSetId: `set${i}` }] }));
    tx.productionScheduleSessakuPieceSet.findMany.mockResolvedValue(sets);
    records = [];
    await reconcile([1]);
    const updates = tx.productionScheduleSessakuPieceSet.updateMany.mock.calls;
    expect(updates.map(([{ where }]) => where.id.in.length)).toEqual([300, 300, 1]);
    expect(updates.flatMap(([{ where, data }]) => {
      expect(data).toEqual({ version: { increment: 1 } });
      return where.id.in;
    })).toEqual(sets.map((entry) => entry.id));
  });
  it('groups equal retained operations and bounds each delete for 4000 pieces and 20 operations', async () => {
    set.pieces = Array.from({ length: 4000 }, (_, i) => ({ ...set.pieces[0], id: `p${i}` }));
    const opNos = Array.from({ length: 20 }, (_, i) => i + 1);
    // Each group must keep its own retained operations, irrespective of input ordering.
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'third', resourceCd: '022', fhincd: 'PART', ops: [{ opNo: 20 }] }
    ]);
    mocks.overrides.mockResolvedValue(Array.from({ length: 2000 }, (_, i) => ['site', 'third'].map((siteKey) =>
      ({ siteKey, itemKey: `piece:p${i}`, overrideResourceCd: '022' }))).flat());
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([
      { siteKey: 'site', seibanOrder: ['S'] }, { siteKey: 'other', seibanOrder: ['S'] }
    ]);
    records = set.pieces.flatMap((piece) => [{ pieceId: piece.id, opNo: 1 }, { pieceId: piece.id, opNo: 20 }]);
    await reconcile(opNos);
    expect(records).toHaveLength(6000);
    expect(records.filter((record) => record.opNo === 1)).toHaveLength(2000);
    const calls = tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mock.calls;
    expect(calls).toHaveLength(14);
    const deletedIds = calls.flatMap(([{ where }]) => {
      expect(where.pieceId.in.length).toBeLessThanOrEqual(300);
      expect(where.pieceId.in.length + where.opNo.notIn.length).toBeLessThanOrEqual(320);
      expect(where.opNo.notIn).toEqual(Number(where.pieceId.in[0].slice(1)) < 2000 ? [20] : opNos);
      return where.pieceId.in;
    });
    expect(new Set(deletedIds).size).toBe(4000);
    const reads = tx.productionScheduleSessakuPieceOpCompletion.findMany.mock.calls;
    expect(reads).toHaveLength(14);
    expect(reads.map(([{ where }]) => where.pieceId.in.length)).toEqual([...Array(13).fill(300), 100]);
    expect(reads.flatMap(([{ where }]) => where.pieceId.in)).toEqual(set.pieces.map((piece) => piece.id));
    expect(tx.productionScheduleSessakuPieceSet.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('parent-row operation batching', () => {
  const pieces = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, isCompleted: i % 2 === 0, effectiveResourceCd: i < 50 ? '021' : '022', fhincd: ' PART ' }));
  it('loads definitions once for repeated resource/part pairs including unregistered operations', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'part', resourceCd: '021', fhincd: 'PART' }, { id: 'empty', resourceCd: '022', fhincd: 'PART' }]);
    tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.findMany.mockResolvedValue([{ partMinutesId: 'part', opNo: 1 }, { partMinutesId: 'part', opNo: 3 }]);
    expect(await syncWholePiecesOperationCompletions(client, 'site', pieces, true)).toBe(true);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.findMany).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).toHaveBeenCalledWith({
      data: pieces.slice(0, 50).flatMap((piece) => [1, 3].map((opNo) => ({ pieceId: piece.id, opNo }))), skipDuplicates: true
    });
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).toHaveBeenCalledTimes(1);
  });
  it('does not query each piece when every part has no registered definition', async () => {
    tx.$queryRaw.mockResolvedValue([]);
    expect(await syncWholePiecesOperationCompletions(client, 'site', pieces, true)).toBe(false);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.findMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
  });
  it('preserves partial operation evidence when every piece is already incomplete', async () => {
    expect(await syncWholePiecesOperationCompletions(client, 'site', pieces.map((piece) => ({ ...piece, isCompleted: false })), false)).toBe(false);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).not.toHaveBeenCalled();
  });
  it('deletes only completed pieces operation evidence on cancellation without reading definitions', async () => {
    tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mockResolvedValue({ count: 2 });
    expect(await syncWholePiecesOperationCompletions(client, 'site', pieces, false)).toBe(true);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { pieceId: { in: pieces.filter((piece) => piece.isCompleted).map((piece) => piece.id) } } });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
  it('counts a registered site without board state or overrides as inheriting the base resource', async () => {
    tx.site.findMany.mockResolvedValue([{ key: 'site' }, { key: 'idle' }]);
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'site', seibanOrder: ['OTHER'] }]);
    mocks.overrides.mockResolvedValue([{ siteKey: 'site', itemKey: 'piece:p', overrideResourceCd: '022' }]);
    tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockResolvedValue([
      { siteKey: 'site', resourceCd: '021', fhincd: 'PART', ops: [{ opNo: 2 }] },
      { siteKey: 'site', resourceCd: '022', fhincd: 'PART', ops: [{ opNo: 1 }, { opNo: 3 }] }
    ]);
    records = [{ pieceId: 'p', opNo: 2 }, { pieceId: 'p', opNo: 3 }];
    await reconcileOperationDefinitionPieces(client, { siteKey: 'site', resourceCd: '022' }, [key], [1]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 2 }]);
  });
});
