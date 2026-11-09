import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { SessakuPieceSet } from '../piece-key.js';

const mocks = vi.hoisted(() => ({ critical: vi.fn(), logical: vi.fn(), board: vi.fn(), rowLock: vi.fn(),
  rows: vi.fn(), details: vi.fn(), overrides: vi.fn() }));
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
  $queryRaw: vi.fn(), productionScheduleSessakuPiece: { update: vi.fn() },
  productionScheduleGrindingPlanningBoardResourcePartMinutes: { findMany: vi.fn() },
  productionScheduleGrindingPlanningBoardResourcePartOpMinutes: { findMany: vi.fn() },
  productionScheduleGrindingPlanningBoardState: { findMany: vi.fn() },
  productionScheduleGrindingPlanningBoardOverride: { findMany: mocks.overrides },
  productionScheduleSessakuPieceSet: { findMany: vi.fn(), updateMany: vi.fn() },
  productionScheduleSessakuPieceOpCompletion: { deleteMany: vi.fn(), findMany: vi.fn(), createMany: vi.fn() }
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
  mocks.details.mockImplementation(async () => new Map([['row', { productionScheduleExternalCompletion: { isExternallyCompleted: external } }]]));
  tx.productionScheduleSessakuPieceOpCompletion.findMany.mockImplementation(async ({ where }) => records.filter((record) => where.pieceId.in.includes(record.pieceId)));
  tx.productionScheduleSessakuPieceOpCompletion.createMany.mockImplementation(async ({ data }) => { records.push(...data); return { count: data.length }; });
  tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mockImplementation(async ({ where }) => {
    const count = records.length;
    records = records.filter((record) => !where.pieceId.in.includes(record.pieceId) || where.opNo.notIn.includes(record.opNo));
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
  it('filters logical locks by displayed seibans before locking', async () => {
    tx.$queryRaw.mockResolvedValueOnce([]);
    expect(await lockOperationDefinitionPieces(client, 'PART')).toEqual([]);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('BTRIM("fseiban"');
    expect(tx.$queryRaw.mock.calls[0].slice(1)).toContainEqual(['S']);
    expect(mocks.logical).not.toHaveBeenCalled(); expect(mocks.board).not.toHaveBeenCalled();
  });
  it('takes no piece locks when no site displays any seiban', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'site', seibanOrder: [] }]);
    expect(await lockOperationDefinitionPieces(client, 'PART')).toEqual([]);
    expect(tx.$queryRaw).not.toHaveBeenCalled(); expect(mocks.logical).not.toHaveBeenCalled();
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
  it('never completes an unfinished piece when the missing operation is removed', async () => {
    records.push({ pieceId: 'p', opNo: 3 }); await reconcile([1]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]); expect(set.pieces[0].isCompleted).toBe(false);
    expect(tx.productionScheduleSessakuPiece.update).not.toHaveBeenCalled();
  });
  it('keeps a completed piece closed and fills newly added operation evidence', async () => {
    set.pieces[0].isCompleted = true; const before = { ...set.pieces[0] }; await reconcile([1, 2]);
    expect(set.pieces[0]).toEqual(before); expect(records).toEqual([{ pieceId: 'p', opNo: 1 }, { pieceId: 'p', opNo: 2 }]);
    expect(tx.productionScheduleSessakuPiece.update).not.toHaveBeenCalled();
  });
  it.each([true, false])('preserves completion=%s when the definition is emptied', async (isCompleted) => {
    set.pieces[0].isCompleted = isCompleted; await reconcile([]);
    expect(records).toEqual([]); expect(set.pieces[0].isCompleted).toBe(isCompleted);
    expect(tx.productionScheduleSessakuPiece.update).not.toHaveBeenCalled();
  });
  it('does not touch externally completed pieces or records', async () => {
    external = true; await reconcile([2]);
    expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPieceSet.updateMany).not.toHaveBeenCalled();
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).not.toHaveBeenCalled();
  });
  it('matches effective resource, with an own override replacing parent inheritance', async () => {
    mocks.overrides.mockResolvedValue([{ siteKey: 'site', itemKey: sessakuPieceParentItemId(key), overrideResourceCd: '021' }, { siteKey: 'site', itemKey: 'piece:p', overrideResourceCd: '022' }]);
    await reconcile([2]); expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPieceSet.updateMany).not.toHaveBeenCalled();
    mocks.overrides.mockResolvedValue([{ siteKey: 'site', itemKey: sessakuPieceParentItemId(key), overrideResourceCd: '022' }, { siteKey: 'site', itemKey: 'piece:p', overrideResourceCd: '021' }]);
    await reconcile([2]); expect(records).toEqual([]); expect(set.pieces[0].isCompleted).toBe(false);
  });
  it('does not touch pieces absent from every site board', async () => {
    tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'site', seibanOrder: ['OTHER'] }]);
    await reconcile([2]); expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).not.toHaveBeenCalled();
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
    expect(mocks.overrides.mock.calls[0][0].where.siteKey).toBeUndefined();
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
    await reconcile([2]); expect(records).toEqual([{ pieceId: 'p', opNo: 1 }]);
    expect(tx.productionScheduleSessakuPieceSet.updateMany).not.toHaveBeenCalled();
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
  const pieces = Array.from({ length: 100 }, (_, i) => ({ id: `p${i}`, effectiveResourceCd: i < 50 ? '021' : '022', fhincd: ' PART ' }));
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
  it('deletes all pieces operation evidence together on cancellation without reading definitions', async () => {
    tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mockResolvedValue({ count: 2 });
    expect(await syncWholePiecesOperationCompletions(client, 'site', pieces, false)).toBe(true);
    expect(tx.productionScheduleSessakuPieceOpCompletion.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { pieceId: { in: pieces.map((piece) => piece.id) } } });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
