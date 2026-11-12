import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { ProductionScheduleGrindingPlanningBoardOverride as Override, Prisma } from '@prisma/client';
import type { GrindingPlanningBoardResourceMinutesResponse } from '@raspi-system/shared-types';
import type { SessakuPieceSet } from '../piece-key.js';
import type { GrindingPlanningBoardProjectionRowDetail } from '../../grinding-planning-board-projection.js';

const mocks = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(), $executeRaw: vi.fn(),
    productionScheduleGrindingPlanningBoardState: { findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    productionScheduleGrindingPlanningBoardTestBar: { findMany: vi.fn(), updateMany: vi.fn() },
    productionScheduleGrindingPlanningBoardOverride: { findMany: vi.fn(), deleteMany: vi.fn() },
    productionScheduleOrderAssignment: { findMany: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceCapacity: { findMany: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceMinutesSource: { findMany: vi.fn() },
    productionScheduleGrindingPlanningBoardResourcePartMinutes: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    productionScheduleGrindingPlanningBoardResourcePartOpMinutes: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    productionScheduleSessakuPieceHistory: { findUnique: vi.fn(), upsert: vi.fn() },
    productionScheduleSessakuPieceSet: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    productionScheduleSessakuPiece: { findMany: vi.fn(), update: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
    productionScheduleSessakuPieceOpSplit: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
    productionScheduleSessakuPieceOpCompletion: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() }
  },
  transaction: vi.fn(), readSet: vi.fn(), winner: vi.fn(), rows: vi.fn(), details: vi.fn(), sets: vi.fn(),
  overrides: vi.fn(), logicalLocks: vi.fn(), boardLocks: vi.fn(), progress: vi.fn(), quantities: vi.fn()
}));
vi.mock('../../../../lib/prisma.js', () => ({ prisma: { ...mocks.tx, $transaction: mocks.transaction } }));
vi.mock('../../grinding-planning-board/state.js', () => ({ ensurePlanningBoardState: vi.fn(), stateOrder: () => ['S'] }));
vi.mock('../../grinding-planning-board/source.js', () => ({
  readWinnerRowsByLogicalKeyFseibans: mocks.rows, readWinnerRowsByFseibans: mocks.rows,
  readRowDetails: mocks.details, readOverrides: mocks.overrides, readRanks: async () => ({ rows: new Map() })
}));
vi.mock('../piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../piece-key.js')>(),
  readSessakuPieceSet: mocks.readSet, readSessakuPieceSets: mocks.sets, findSessakuPieceWinner: mocks.winner,
  acquireSessakuPieceLogicalLocks: mocks.logicalLocks, acquireSessakuPieceBoardStateLocks: mocks.boardLocks,
  resolveSessakuPieceItemKeys: async (_client: unknown, keys: string[]) => new Map(keys.map((id) => [id, { fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10' }]))
}));
vi.mock('../piece-audit.js', async () => ({ pieceTimingStage: new (await import('node:async_hooks')).AsyncLocalStorage(),
  readLaterPieceAuditSnapshots: async () => [], collectLaterPiecePropagationAudits: () => [],
  runSessakuPieceOperation: async (audit: unknown, callback: (audit: unknown) => unknown) => callback(audit) }));
vi.mock('../piece-completion.js', () => ({ reconcileSessakuPieceProgress: mocks.progress }));
vi.mock('../piece-quantity.js', () => ({ reconcileSessakuPieceQuantities: mocks.quantities }));
vi.mock('../../policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: async () => ({}), isProductionScheduleCuttingResourceCd: () => true }));
vi.mock('../../fkojunst-status-mail-critical-lock.js', () => ({ acquireFkojunstStatusMailCriticalTransactionLock: vi.fn() }));
vi.mock('../../order-assignment/production-schedule-parent-row-lock.service.js', () => ({ acquireProductionScheduleParentRowLockInTransaction: vi.fn(), acquireProductionScheduleParentRowLocksInTransaction: vi.fn() }));
import { configureSessakuPieceOps, clearSessakuPieceOps, splitSessakuPieceOps, mergeSessakuPieceOps, splitSessakuPieces, mergeSessakuPieces, setSessakuPieceOpCompletion, setSessakuPieceCompletion } from '../sessaku-pieces.service.js';
import { projectGrindingPlanningBoard } from '../../grinding-planning-board-projection.js';
import { encodeSessakuPieceKey, sessakuPieceParentItemId } from '../piece-key.js';

const key = { fseiban: 'S', fhincd: 'PART', fsigencd: '021', fkojun: '10' };
const row = { id: 'row', rowData: { FSEIBAN: 'S', FHINCD: 'PART', FSIGENCD: '021', FKOJUN: '10', ProductNo: '1', FSIGENSHOYORYO: '100' }, updatedAt: null };
const now = new Date('2026-11-11T00:00:00Z');
let set: SessakuPieceSet;
let overrides: Map<string, Override>;
let completed: Set<number>;
let detail: GrindingPlanningBoardProjectionRowDetail;
let settings: GrindingPlanningBoardResourceMinutesResponse;
const pieceId = () => set.pieces[0].id;
const headId = () => `piece:${pieceId()}`;
const barId = (opNo: number) => `pieceops:${pieceId()}:${opNo}`;
const items = () => projectGrindingPlanningBoard({ rows: [row], details: new Map([['row', detail]]), overrides,
  pieceSets: new Map([[encodeSessakuPieceKey(key), set]]), ranks: { rows: new Map() }, category: 'all', view: 'resource', seibanOrder: ['S'],
  includePieces: true, resourceMinutes: settings, resourceCapacity: { unitSplitEnabledByResource: { '021': true, '022': false }, dailyHoursByResource: {}, runsThroughBreaksResources: [] }
}).items;
const current = (itemId: string) => items().find((item) => item.itemId === itemId)!;
const request = (itemId: string) => ({ siteKey: 'site', itemId, expectedPieceSetVersion: set.version, itemRevision: current(itemId).itemRevision });
const split = (fromOpNo: number, itemId = headId()) => splitSessakuPieceOps({ ...request(itemId), fromOpNo });
const merge = (fromOpNo: number) => mergeSessakuPieceOps(request(barId(fromOpNo)));
const override = (itemKey: string, data: Partial<Override> = {}): Override => ({
  id: randomUUID(), csvDashboardId: 'dashboard', siteKey: 'site', itemKey, overrideResourceCd: '021', overrideDueDate: null,
  dueDateCleared: null, orderPinned: false, specialDueKind: null, specialDueExpiresAt: null, alternateRank: 1, version: 1, createdAt: now, updatedAt: now, ...data
});
function syncCompletionRecords() { set.pieces[0].opCompletions = [...completed].map((opNo) => ({ opNo })); }

// The real lane writer uses one SQL statement for all copied placements. This delegate
// implements that statement's stored rows so the next real projection reads its result.
function persistLaneSql(sql: Prisma.Sql) {
  if (sql.sql?.includes('INSERT INTO "ProductionScheduleGrindingPlanningBoardOverride"')) {
    const [dashboard, updatedAt, ids, sites, keys, resources, dues, cleared, pinned, kinds, expires, ranks] = sql.values as unknown as [
      string, Date, string[], string[], string[], Array<string | null>, Array<string | null>, Array<boolean | null>, boolean[], Array<string | null>, Array<string | null>, number[]
    ];
    keys.forEach((itemKey, index) => overrides.set(itemKey, override(itemKey, {
      id: ids[index], csvDashboardId: dashboard, siteKey: sites[index], overrideResourceCd: resources[index],
      overrideDueDate: dues[index] ? new Date(dues[index]!) : null, dueDateCleared: cleared[index], orderPinned: pinned[index],
      specialDueKind: kinds[index], specialDueExpiresAt: expires[index] ? new Date(expires[index]!) : null,
      alternateRank: ranks[index], version: (overrides.get(itemKey)?.version ?? 0) + 1, updatedAt
    })));
  } else if (sql.sql?.includes('DELETE FROM "ProductionScheduleGrindingPlanningBoardOverride"')) {
    const keys = sql.values[1] as string[];
    keys.forEach((itemKey) => overrides.delete(itemKey));
  }
  return 1;
}

describe('piece operation boundary mutations', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    completed = new Set(); overrides = new Map();
    set = { ...key, id: 'set', csvDashboardId: 'dashboard', version: 1, nextPosition: 2, plannedQuantity: 1, quantityWarning: null,
      sourcePieceSetId: null, createdAt: now, updatedAt: now, pieces: [{ id: randomUUID(), pieceSetId: 'set', quantity: 1, position: 1,
        sourcePieceId: null, isCompleted: false, completedAt: null, createdAt: now, updatedAt: now, opCompletions: [], opSplits: [] }] };
    settings = { ownSourceResourceCds: ['021', '022'], values: ['021', '022'].map((resourceCd, index) => ({
      resourceCd, fhincd: 'PART', perUnitMinutes: 100 * (index + 1), setupMinutes: 10,
      ops: [1, 2, 3, 4].map((opNo) => ({ id: `${resourceCd}-${opNo}`, opNo, minutes: opNo * 10 * (index + 1), setupMinutes: opNo }))
    })) };
    detail = { updatedAt: null, rowNotes: [], orderSupplements: [{ plannedQuantity: 1, plannedEndDate: null }], productionScheduleProgress: null, productionScheduleExternalCompletion: null };
    mocks.rows.mockResolvedValue([row]); mocks.details.mockImplementation(async () => new Map([['row', detail]]));
    mocks.readSet.mockImplementation(async () => set); mocks.sets.mockImplementation(async () => new Map([[encodeSessakuPieceKey(key), set]]));
    mocks.winner.mockResolvedValue(row); mocks.logicalLocks.mockResolvedValue(new Set([encodeSessakuPieceKey(key)]));
    mocks.transaction.mockImplementation((callback) => callback(mocks.tx));
    mocks.overrides.mockImplementation(async () => new Map(overrides));
    mocks.tx.$queryRaw.mockImplementation(async (sql) => String(sql).includes('FOR SHARE') ? [{ id: 'part' }] : []);
    mocks.tx.$executeRaw.mockImplementation(async (sql) => persistLaneSql(sql));
    mocks.tx.productionScheduleGrindingPlanningBoardOverride.findMany.mockImplementation(async ({ where, select }) => {
      const keys = where?.itemKey?.in;
      const rows = [...overrides.values()].filter((value) => (!keys || keys.includes(value.itemKey))
        && (where?.overrideResourceCd?.not !== null || value.overrideResourceCd !== null));
      return select ? rows.map((value) => ({ siteKey: value.siteKey, itemKey: value.itemKey, overrideResourceCd: value.overrideResourceCd })) : rows;
    });
    mocks.tx.productionScheduleGrindingPlanningBoardOverride.deleteMany.mockImplementation(async ({ where }) => {
      const ids = where.itemKey?.in ?? [where.itemKey]; let count = 0;
      for (const id of ids) if (overrides.delete(id)) count += 1;
      return { count };
    });
    for (const table of [mocks.tx.productionScheduleOrderAssignment, mocks.tx.productionScheduleSessakuPieceSet,
      mocks.tx.productionScheduleGrindingPlanningBoardResourceCapacity, mocks.tx.productionScheduleGrindingPlanningBoardTestBar]) table.findMany.mockResolvedValue([]);
    mocks.tx.productionScheduleGrindingPlanningBoardResourceMinutesSource.findMany.mockImplementation(async () => settings.ownSourceResourceCds.map((resourceCd) => ({ resourceCd })));
    mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany.mockImplementation(async () => settings.values);
    mocks.tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.findMany.mockImplementation(async () => settings.values[0].ops);
    mocks.tx.productionScheduleGrindingPlanningBoardState.findMany.mockResolvedValue([{ siteKey: 'site', seibanOrder: ['S'] }]);
    mocks.tx.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow.mockResolvedValue({ seibanOrder: ['S'] });
    mocks.tx.productionScheduleSessakuPieceSet.update.mockImplementation(async () => { set.version += 1; });
    mocks.tx.productionScheduleSessakuPiece.findMany.mockImplementation(async ({ where }) =>
      set.pieces.filter((piece) => where.id.in.includes(piece.id)).map((piece) => ({ ...piece, pieceSet: key })));
    mocks.tx.productionScheduleSessakuPieceOpSplit.create.mockImplementation(async ({ data }) => { set.pieces[0].opSplits!.push({ ...data }); return data; });
    mocks.tx.productionScheduleSessakuPieceOpSplit.update.mockImplementation(async ({ where, data }) => {
      const saved = set.pieces[0].opSplits!.find((split) => split.fromOpNo === where.pieceId_fromOpNo.fromOpNo)!;
      Object.assign(saved, data); return saved;
    });
    mocks.tx.productionScheduleSessakuPieceOpSplit.delete.mockImplementation(async ({ where }) => {
      set.pieces[0].opSplits = set.pieces[0].opSplits!.filter((split) => split.fromOpNo !== where.pieceId_fromOpNo.fromOpNo);
    });
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst.mockResolvedValue(null);
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findMany.mockImplementation(async () => [...completed].map((opNo) => ({ pieceId: pieceId(), opNo })));
    mocks.tx.productionScheduleSessakuPieceOpCompletion.upsert.mockImplementation(async ({ create }) => { completed.add(create.opNo); syncCompletionRecords(); });
    mocks.tx.productionScheduleSessakuPieceOpCompletion.createMany.mockImplementation(async ({ data }) => {
      const before = completed.size; data.forEach((op: { opNo: number }) => completed.add(op.opNo)); syncCompletionRecords(); return { count: completed.size - before };
    });
    mocks.tx.productionScheduleSessakuPieceOpCompletion.deleteMany.mockImplementation(async ({ where }) => {
      const count = where.opNo === undefined ? completed.size : Number(completed.has(where.opNo));
      if (where.opNo === undefined) completed.clear(); else completed.delete(where.opNo);
      syncCompletionRecords(); return { count };
    });
    mocks.tx.productionScheduleSessakuPiece.update.mockImplementation(async ({ data }) => { Object.assign(set.pieces[0], data); });
    mocks.progress.mockImplementation(async () => ({ parentIsCompleted: set.pieces.every((piece) => piece.isCompleted) }));
  });

  function configuration(minutes: number[] = [10, 20], itemId = headId()) {
    const saved = settings.values.find((value) => value.resourceCd === '021');
    return { ...request(itemId), resourceCd: '021', minutes, expectedOpIds: saved?.ops?.flatMap((op) => op.id ? [op.id] : []) ?? [],
      expectedMinutes: saved ? { perUnitMinutes: saved.perUnitMinutes, setupMinutes: saved.setupMinutes,
        ops: (saved.ops ?? []).map((op) => ({ opNo: op.opNo, minutes: op.minutes, setupMinutes: op.setupMinutes ?? null })) } : null };
  }
  function installDefinitionWrites() {
    const parts = mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes;
    const ops = mocks.tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes;
    parts.findUnique.mockImplementation(async ({ where }) => {
      const value = settings.values.find((value) => value.resourceCd === where.csvDashboardId_siteKey_resourceCd_fhincd.resourceCd);
      return value ? { ...value, id: 'part', ops: [...(value.ops ?? [])] } : null;
    });
    parts.upsert.mockImplementation(async ({ create, update }) => {
      let value = settings.values.find((value) => value.resourceCd === create.resourceCd);
      const before = value ? { ...value, id: 'part', ops: [...(value.ops ?? [])] } : null;
      if (!value) { value = { ...create, ops: [] }; settings.values.push(value!); }
      else Object.assign(value, update);
      return before ?? { ...value, id: 'part', ops: [] };
    });
    parts.update.mockImplementation(async ({ data }) => Object.assign(settings.values[0], data));
    ops.findMany.mockImplementation(async () => settings.values[0]?.ops ?? []);
    ops.update.mockImplementation(async ({ where, data }) => Object.assign(settings.values[0].ops!.find((op) => op.id === where.id)!, data));
    ops.deleteMany.mockImplementation(async ({ where }) => { settings.values[0].ops = settings.values[0].ops!.filter((op) => !where.id.in.includes(op.id)); });
    ops.createMany.mockImplementation(async ({ data }) => { settings.values[0].ops!.push(...data.map((op: { opNo: number }) => ({ ...op, id: `new-${op.opNo}` }))); });
    mocks.tx.productionScheduleSessakuPieceOpSplit.deleteMany.mockImplementation(async ({ where }) => {
      set.pieces.find((piece) => piece.id === where.pieceId)!.opSplits = [];
    });
    mocks.tx.productionScheduleSessakuPieceOpSplit.createMany.mockImplementation(async ({ data }) => {
      for (const split of data) set.pieces.find((piece) => piece.id === split.pieceId)!.opSplits!.push({ ...split });
    });
  }

  it('registers an unconfigured part once and splits all five unit pieces, leaving another lot untouched', async () => {
    installDefinitionWrites(); settings.values = [];
    set.pieces = Array.from({ length: 5 }, (_, index) => ({ ...set.pieces[0], id: randomUUID(), position: index + 1, opSplits: [], opCompletions: [] }));
    set.plannedQuantity = 5; detail.orderSupplements[0].plannedQuantity = 5;
    const other = { ...set, id: 'other', fseiban: 'OTHER', pieces: [{ ...set.pieces[0], id: randomUUID(), opSplits: [] }] };
    const otherBefore = structuredClone(other);
    mocks.sets.mockImplementation(async () => new Map([[encodeSessakuPieceKey(key), set], [encodeSessakuPieceKey(other), other]]));
    const response = await configureSessakuPieceOps(configuration([5, 10, 15]));
    expect(settings.values).toHaveLength(1);
    expect(settings.values[0]).toMatchObject({ resourceCd: '021', fhincd: 'PART', perUnitMinutes: 30,
      ops: [{ opNo: 1, minutes: 5, setupMinutes: 0 }, { opNo: 2, minutes: 10, setupMinutes: 0 }, { opNo: 3, minutes: 15, setupMinutes: 0 }] });
    expect(set.pieces.map((piece) => piece.opSplits!.map((split) => split.fromOpNo))).toEqual(Array.from({ length: 5 }, () => [2, 3]));
    expect(response.pieces).toHaveLength(15);
    expect(other).toEqual(otherBefore);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it('preserves existing operation numbers and setup by number, then replaces every existing boundary', async () => {
    installDefinitionWrites();
    settings.values[0].ops = [{ id: 'a', opNo: 3, minutes: 10, setupMinutes: 5 }, { id: 'b', opNo: 7, minutes: 20, setupMinutes: 10 }];
    settings.values[0].perUnitMinutes = 30; settings.values[0].setupMinutes = 15;
    await configureSessakuPieceOps(configuration([8, 12, 10]));
    expect(settings.values[0].ops).toMatchObject([{ opNo: 3, setupMinutes: 5 }, { opNo: 7, setupMinutes: 10 }, { opNo: 8, setupMinutes: 0 }]);
    expect(set.pieces[0].opSplits!.map((split) => split.fromOpNo)).toEqual([7, 8]);
    await configureSessakuPieceOps(configuration([30], barId(7)));
    expect(set.pieces[0].opSplits).toEqual([]);
    expect(settings.values[0].ops).toMatchObject([{ opNo: 3, minutes: 30, setupMinutes: 5 }]);
  });

  it('clears every boundary of the pressed piece or the whole lot and keeps the registration', async () => {
    installDefinitionWrites();
    set.pieces.push({ ...set.pieces[0], id: randomUUID(), position: 2, opSplits: [], opCompletions: [] });
    set.plannedQuantity = 2; detail.orderSupplements[0].plannedQuantity = 2;
    await configureSessakuPieceOps(configuration([10, 20, 30]));
    const saved = structuredClone(settings.values);
    overrides.set(barId(2), override(barId(2)));
    const head = overrides.get(headId());
    await clearSessakuPieceOps({ ...request(barId(2)), scope: 'piece' });
    expect(set.pieces[0].opSplits).toEqual([]);
    expect(set.pieces[1].opSplits).toHaveLength(2);
    expect(overrides.has(barId(2))).toBe(false);
    expect(overrides.get(headId())).toEqual(head);
    await clearSessakuPieceOps({ ...request(headId()), scope: 'set' });
    expect(set.pieces.every((piece) => !piece.opSplits!.length)).toBe(true);
    expect(settings.values).toEqual(saved);
  });

  it.each(['configure', 'set'] as const)('leaves completed pieces and their placements untouched during %s', async (action) => {
    installDefinitionWrites();
    await split(3);
    set.pieces[0].isCompleted = true;
    completed = new Set([1, 2, 3, 4]); syncCompletionRecords();
    const done = set.pieces[0];
    const unfinished = { ...done, id: randomUUID(), position: 2, isCompleted: false, completedAt: null,
      opCompletions: [], opSplits: [{ fromOpNo: 3, sourceResourceCd: '021', leadingSourceResourceCd: '021' }] };
    const nonUnit = { ...unfinished, id: randomUUID(), position: 3, quantity: 2, opSplits: [] };
    set.pieces.push(unfinished, nonUnit);
    set.plannedQuantity = 4; detail.orderSupplements[0].plannedQuantity = 4;
    overrides.set(headId(), override(headId(), { alternateRank: 1 }));
    overrides.set(barId(3), override(barId(3), { alternateRank: 2 }));
    const before = structuredClone(done);
    const placements = [structuredClone(overrides.get(headId())), structuredClone(overrides.get(barId(3)))];
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst.mockImplementation(async ({ where }) =>
      where.pieceId.in.includes(done.id) ? { pieceId: done.id } : null);
    const selectedId = `piece:${unfinished.id}`;
    if (action === 'configure') await configureSessakuPieceOps(configuration([10, 20, 30], selectedId));
    else await clearSessakuPieceOps({ ...request(selectedId), scope: 'set' });
    expect(done).toEqual(before);
    expect([overrides.get(headId()), overrides.get(barId(3))]).toEqual(placements);
    expect(unfinished.opSplits.map((split) => split.fromOpNo)).toEqual(action === 'configure' ? [2, 3] : []);
    expect(nonUnit.opSplits).toEqual([]);
    if (action === 'configure') expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst).toHaveBeenLastCalledWith({
      where: { pieceId: { in: [unfinished.id] } }, select: { pieceId: true }
    });
    else expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst).not.toHaveBeenCalled();
    const changedIds = mocks.tx.productionScheduleSessakuPieceOpSplit.deleteMany.mock.calls.map(([args]) => args.where.pieceId);
    expect(changedIds).toEqual(action === 'configure' ? [unfinished.id] : [unfinished.id, nonUnit.id]);
  });

  it.each(['configure'] as const)('rejects operation evidence on another unfinished target during %s', async (action) => {
    installDefinitionWrites();
    const sibling = { ...set.pieces[0], id: randomUUID(), position: 2, opCompletions: [{ opNo: 1 }], opSplits: [] };
    set.pieces.push(sibling);
    set.plannedQuantity = 2; detail.orderSupplements[0].plannedQuantity = 2;
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst.mockImplementation(async ({ where }) =>
      where.pieceId.in.includes(sibling.id) ? { pieceId: sibling.id } : null);
    const operation = action === 'configure' ? configureSessakuPieceOps(configuration())
      : clearSessakuPieceOps({ ...request(headId()), scope: 'set' });
    await expect(operation).rejects.toMatchObject({ statusCode: 409, code: 'PIECE_OPERATION_COMPLETED' });
    expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['piece', 'set'] as const)('clears %s boundaries while preserving operation completion evidence', async (scope) => {
    installDefinitionWrites();
    await split(3);
    completed = new Set([1]); syncCompletionRecords();
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst.mockResolvedValue({ pieceId: pieceId() });
    const evidence = structuredClone(set.pieces[0].opCompletions);
    const saved = structuredClone(settings.values);
    await clearSessakuPieceOps({ ...request(headId()), scope });
    expect(set.pieces[0].opSplits).toEqual([]);
    expect(set.pieces[0].opCompletions).toEqual(evidence);
    expect(settings.values).toEqual(saved);
    expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['other lot', 'completed', 'other machine', 'non-unit'])('rejects a disappearing boundary used by %s before any writes', async (kind) => {
    installDefinitionWrites();
    const outside = { ...set.pieces[0], id: randomUUID(), position: 2, isCompleted: kind === 'completed',
      quantity: kind === 'non-unit' ? 2 : 1, opSplits: [{ fromOpNo: 3, sourceResourceCd: '021' }] };
    if (kind !== 'other lot') {
      set.pieces.push(outside); set.plannedQuantity += outside.quantity;
      detail.orderSupplements[0].plannedQuantity = set.plannedQuantity;
      if (kind === 'other machine') {
        overrides.set(`piece:${outside.id}`, override(`piece:${outside.id}`, { overrideResourceCd: '022' }));
        overrides.set(`pieceops:${outside.id}:3`, override(`pieceops:${outside.id}:3`, { overrideResourceCd: '022' }));
      }
    }
    mocks.tx.productionScheduleSessakuPieceOpSplit.findFirst.mockImplementation(async ({ where }) =>
      where.fromOpNo.in.includes(3) && !where.pieceId.notIn.includes(outside.id) ? { pieceId: outside.id } : null);
    const before = structuredClone({ set, values: settings.values });
    await expect(configureSessakuPieceOps(configuration())).rejects.toMatchObject({ statusCode: 409, code: 'OPERATION_SPLIT_IN_USE' });
    expect({ set, values: settings.values }).toEqual(before);
    expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.deleteMany).not.toHaveBeenCalled();
    expect(mocks.tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('does not configure a unit moved to another effective machine', async () => {
    installDefinitionWrites();
    const other = { ...set.pieces[0], id: randomUUID(), position: 2, opSplits: [] };
    set.pieces.push(other); set.plannedQuantity = 2; detail.orderSupplements[0].plannedQuantity = 2;
    overrides.set(`piece:${other.id}`, override(`piece:${other.id}`, { overrideResourceCd: '022' }));
    await configureSessakuPieceOps(configuration());
    expect(set.pieces[0].opSplits!.map((split) => split.fromOpNo)).toEqual([2]);
    expect(other.opSplits).toEqual([]);
    expect(overrides.get(`piece:${other.id}`)?.overrideResourceCd).toBe('022');
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not configure a unit whose leading bar is on another machine even when a later bar is here', async () => {
    installDefinitionWrites();
    const other = { ...set.pieces[0], id: randomUUID(), position: 2,
      opSplits: [{ fromOpNo: 3, sourceResourceCd: '021', leadingSourceResourceCd: '021' }] };
    set.pieces.push(other); set.plannedQuantity = 2; detail.orderSupplements[0].plannedQuantity = 2;
    overrides.set(`piece:${other.id}`, override(`piece:${other.id}`, { overrideResourceCd: '022' }));
    await configureSessakuPieceOps(configuration());
    expect(set.pieces[0].opSplits!.map((split) => split.fromOpNo)).toEqual([2]);
    expect(other.opSplits).toEqual([{ fromOpNo: 3, sourceResourceCd: '021', leadingSourceResourceCd: '021' }]);
    expect(overrides.get(`piece:${other.id}`)?.overrideResourceCd).toBe('022');
  });

  it('keeps the placement of an existing moved operation interval when configuring', async () => {
    installDefinitionWrites(); await split(3);
    overrides.set(barId(3), override(barId(3), { overrideResourceCd: '022', overrideDueDate: new Date('2026-12-05'), orderPinned: true }));
    await configureSessakuPieceOps(configuration([10, 20, 30, 40]));
    for (const opNo of [3, 4]) expect(overrides.get(barId(opNo))).toMatchObject({
      overrideResourceCd: '022', overrideDueDate: new Date('2026-12-05'), orderPinned: true
    });
    expect(overrides.get(headId())?.overrideResourceCd ?? '021').toBe('021');
  });

  it('rejects adding operations beyond 20 instead of wrapping and reordering input', async () => {
    installDefinitionWrites();
    settings.values[0].ops = [{ id: 'last', opNo: 20, minutes: 30, setupMinutes: 5 }];
    await expect(configureSessakuPieceOps(configuration([12, 18]))).rejects.toMatchObject({ statusCode: 409, code: 'OPERATION_NUMBER_LIMIT' });
    expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects stale piece-set versions, revisions and registration snapshots before writing', async () => {
    installDefinitionWrites();
    const payload = configuration();
    await expect(configureSessakuPieceOps({ ...payload, expectedPieceSetVersion: 0 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(configureSessakuPieceOps({ ...payload, itemRevision: '0'.repeat(64) })).rejects.toMatchObject({ statusCode: 409 });
    await expect(configureSessakuPieceOps({ ...payload, expectedOpIds: [] })).rejects.toMatchObject({ statusCode: 409, code: 'OPERATION_SET_CHANGED' });
    await expect(configureSessakuPieceOps({ ...payload, expectedMinutes: { ...payload.expectedMinutes!, perUnitMinutes: 99 } })).rejects.toMatchObject({ statusCode: 409, code: 'RESOURCE_MINUTES_CHANGED' });
    expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['configure'])('rejects completed operation evidence before %s without changing registration or cuts', async (action) => {
    installDefinitionWrites();
    mocks.tx.productionScheduleSessakuPieceOpCompletion.findFirst.mockResolvedValue({ pieceId: pieceId() });
    const operation = action === 'configure' ? configureSessakuPieceOps(configuration()) : clearSessakuPieceOps({ ...request(headId()), scope: action as 'piece' | 'set' });
    await expect(operation).rejects.toMatchObject({ statusCode: 409, code: 'PIECE_OPERATION_COMPLETED' });
    expect(mocks.tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.upsert).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.deleteMany).not.toHaveBeenCalled();
  });

  it('creates stable bar IDs, ranges and source operation durations and invalidates old writes', async () => {
    const old = request(headId());
    const response = await split(3);
    expect(response.pieceSetVersion).toBe(2);
    expect(response.pieces.map((item) => ({ itemId: item.itemId, range: item.opRange, minutes: item.unitRequiredMinutes, setup: item.setupMinutes, ops: item.ops?.map((op) => op.opNo) }))).toEqual([
      { itemId: headId(), range: { fromOpNo: 1, toOpNo: 2 }, minutes: 30, setup: 3, ops: [1, 2] },
      { itemId: barId(3), range: { fromOpNo: 3, toOpNo: 4 }, minutes: 70, setup: 7, ops: [3, 4] }
    ]);
    expect(response.pieces.every((item) => item.parentItemId === sessakuPieceParentItemId(key) && item.pieceId === pieceId())).toBe(true);
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.create).toHaveBeenCalledWith({ data: {
      pieceId: pieceId(), fromOpNo: 3, sourceResourceCd: '021', leadingSourceResourceCd: '021'
    } });
    expect(response.pieces[0].itemRevision).not.toBe(old.itemRevision);
    await expect(splitSessakuPieceOps({ ...old, fromOpNo: 2 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(splitSessakuPieceOps({ ...request(headId()), itemRevision: old.itemRevision, fromOpNo: 2 })).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.logicalLocks.mock.invocationCallOrder[0]).toBeLessThan(mocks.boardLocks.mock.invocationCallOrder[0]);
  });

  it('copies all placement fields immediately after the original and deletes only the merged bar override', async () => {
    const original = override(headId(), { overrideDueDate: new Date('2026-12-01'), orderPinned: true, dueDateCleared: false,
      specialDueKind: 'today', specialDueExpiresAt: new Date('2026-12-01T15:00:00Z'), alternateRank: 1 });
    overrides.set(headId(), original);
    await split(3);
    expect(overrides.get(barId(3))).toMatchObject({ overrideResourceCd: '021', overrideDueDate: original.overrideDueDate,
      orderPinned: true, dueDateCleared: false, specialDueKind: 'today', specialDueExpiresAt: original.specialDueExpiresAt, alternateRank: 2 });
    const headBefore = overrides.get(headId());
    const response = await merge(3);
    expect(response.pieces.map((item) => item.itemId)).toEqual([headId()]);
    expect(response.pieces[0].opRange).toBeUndefined();
    expect(response.pieces[0].unitRequiredMinutes).toBe(100);
    expect(overrides.has(barId(3))).toBe(false);
    expect(overrides.get(headId())).toEqual(headBefore);
  });

  it('keeps both bar durations on a different machine with unit splitting disabled', async () => {
    await split(3);
    for (const itemId of [headId(), barId(3)]) overrides.set(itemId, override(itemId, { overrideResourceCd: '022' }));
    expect(items().map((item) => [item.effectiveResourceCd, item.unitRequiredMinutes, item.ops?.map((op) => op.opNo)])).toEqual([
      ['022', 30, [1, 2]], ['022', 70, [3, 4]]
    ]);
  });

  it('copies machine, due date, pin and immediate rank when splitting an already completed piece', async () => {
    set.pieces[0].isCompleted = true;
    completed = new Set([1, 2, 3, 4]); syncCompletionRecords();
    const original = override(headId(), { overrideResourceCd: '021', overrideDueDate: new Date('2026-12-05'),
      orderPinned: true, alternateRank: 7 });
    overrides.set(headId(), original);
    const response = await split(3);
    expect(response.pieces).toHaveLength(2);
    expect(response.pieces.every((item) => item.isCompleted)).toBe(true);
    expect(overrides.get(barId(3))).toMatchObject({ overrideResourceCd: original.overrideResourceCd,
      overrideDueDate: original.overrideDueDate, orderPinned: true, alternateRank: 8 });
    expect(response.pieces.find((item) => item.itemId === barId(3))).toMatchObject({
      effectiveResourceCd: '021', effectiveDueDate: '2026-12-05', orderPinned: true, alternateRank: 8
    });
  });

  it('supports repeated inner splits and merging the earliest boundary without losing the original head source', async () => {
    await split(3);
    overrides.set(barId(3), override(barId(3), { overrideResourceCd: '022', alternateRank: 2 }));
    await split(4, barId(3));
    expect(items().map((item) => [item.itemId, item.unitRequiredMinutes])).toEqual([[headId(), 30], [barId(3), 60], [barId(4), 80]]);
    await merge(3);
    expect(items().map((item) => [item.itemId, item.opRange, item.unitRequiredMinutes])).toEqual([
      [headId(), { fromOpNo: 1, toOpNo: 3 }, 60], [barId(4), { fromOpNo: 4, toOpNo: 4 }, 80]
    ]);
    expect(set.pieces[0].opSplits).toMatchObject([{ fromOpNo: 4, sourceResourceCd: '022', leadingSourceResourceCd: '021' }]);
    await merge(4);
    expect(items().map((item) => item.itemId)).toEqual([headId()]);
    expect(set.pieces[0].opSplits).toEqual([]);
  });

  it.each([1, 0, 5, 2.5])('rejects an invalid split boundary %s without writing', async (fromOpNo) => {
    await expect(split(fromOpNo)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_PIECE_OP_BOUNDARY' });
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.create).not.toHaveBeenCalled();
  });

  it('rejects splitting outside the selected interval and merging the leading bar', async () => {
    await split(3);
    await expect(split(3, barId(3))).rejects.toMatchObject({ statusCode: 400 });
    await expect(split(4, headId())).rejects.toMatchObject({ statusCode: 400 });
    await expect(mergeSessakuPieceOps(request(headId()))).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each(['split', 'merge'] as const)('rejects stale operation %s revisions and versions before writes', async (action) => {
    await split(3);
    const itemId = action === 'split' ? headId() : barId(3);
    const run = (params: ReturnType<typeof request>) => action === 'split' ? splitSessakuPieceOps({ ...params, fromOpNo: 2 }) : mergeSessakuPieceOps(params);
    mocks.tx.productionScheduleSessakuPieceOpSplit.create.mockClear();
    await expect(run({ ...request(itemId), expectedPieceSetVersion: set.version - 1 })).rejects.toMatchObject({ statusCode: 409 });
    await expect(run({ ...request(itemId), itemRevision: '0'.repeat(64) })).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.create).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPieceOpSplit.delete).not.toHaveBeenCalled();
  });

  it.each(['split', 'merge'] as const)('rejects quantity %s on a piece that has operation boundaries', async (action) => {
    await split(3);
    const params = { siteKey: 'site', parentItemId: sessakuPieceParentItemId(key), expectedPieceSetVersion: set.version };
    await expect(action === 'split'
      ? splitSessakuPieces({ ...params, targetPieceId: pieceId(), itemRevision: current(headId()).itemRevision, quantities: [1, 1] })
      : mergeSessakuPieces({ ...params, pieceIds: [pieceId(), randomUUID()], itemRevisions: {} }))
      .rejects.toMatchObject({ statusCode: 409, code: 'PIECE_OP_SPLITS_EXIST' });
    expect(mocks.tx.productionScheduleSessakuPiece.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPiece.deleteMany).not.toHaveBeenCalled();
  });

  it('completes intervals separately and completes the whole piece after all operations', async () => {
    await split(3);
    for (const opNo of [1, 2, 3, 4]) {
      const itemId = opNo < 3 ? headId() : barId(3);
      await setSessakuPieceOpCompletion({ ...request(itemId), pieceId: pieceId(), opNo, intent: 'complete' });
      expect(current(headId()).isCompleted).toBe(opNo >= 2);
      expect(current(barId(3)).isCompleted).toBe(opNo === 4);
      expect(set.pieces[0].isCompleted).toBe(opNo === 4);
    }
    await setSessakuPieceOpCompletion({ ...request(barId(3)), pieceId: pieceId(), opNo: 3, intent: 'incomplete' });
    expect(current(headId()).isCompleted).toBe(true);
    expect(current(barId(3)).isCompleted).toBe(false);
    expect(current(headId()).completedOpNos).toEqual([1, 2]);
    expect(current(barId(3)).completedOpNos).toEqual([4]);
  });

  it('applies whole-piece completion and undo to every interval from a trailing bar revision', async () => {
    await split(3);
    overrides.set(barId(3), override(barId(3), { overrideResourceCd: '022' }));
    await setSessakuPieceCompletion({ ...request(barId(3)), pieceId: pieceId(), intent: 'complete' });
    expect([...completed]).toEqual([1, 2, 3, 4]);
    expect(items().every((item) => item.isCompleted)).toBe(true);
    await setSessakuPieceCompletion({ ...request(barId(3)), pieceId: pieceId(), intent: 'incomplete' });
    expect([...completed]).toEqual([]);
    expect(items().every((item) => !item.isCompleted)).toBe(true);
  });

  it('rejects whole-piece completion when itemId and its valid revision belong to another piece', async () => {
    set.pieces.push({ ...set.pieces[0], id: randomUUID(), position: 2, opCompletions: [], opSplits: [] });
    set.plannedQuantity = 2; detail.orderSupplements[0].plannedQuantity = 2;
    const foreignItemId = `piece:${set.pieces[1].id}`;
    await expect(setSessakuPieceCompletion({ ...request(foreignItemId), pieceId: pieceId(), intent: 'complete' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'STALE_SESSAKU_PIECES' });
    expect(mocks.tx.productionScheduleSessakuPieceOpCompletion.createMany).not.toHaveBeenCalled();
    expect(mocks.tx.productionScheduleSessakuPiece.update).not.toHaveBeenCalled();
    expect(set.pieces.every((piece) => !piece.isCompleted)).toBe(true);
  });
});
