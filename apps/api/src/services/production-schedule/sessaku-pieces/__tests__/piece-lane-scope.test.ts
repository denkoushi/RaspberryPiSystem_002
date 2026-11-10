import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import { projectGrindingPlanningBoard } from '../../grinding-planning-board-projection.js';
import { readOverrides, readRanks, readRowDetails, readWinnerRowsByFseibans, readWinnerRowsByLogicalKeyFseibans, type SessakuLaneSourceScope } from '../../grinding-planning-board/source.js';
import { prisma } from '../../../../lib/prisma.js';
import { acquireSessakuPieceLogicalLocks, findSessakuPieceWinner, readSessakuPieceSet, readSessakuPieceSets, sessakuPieceParentItemId, type SessakuPieceSet } from '../piece-key.js';
import { splitSessakuPieces, mergeSessakuPieces } from '../sessaku-pieces.service.js';

vi.mock('../../../../lib/prisma.js', () => ({ prisma: { $transaction: vi.fn() } }));
vi.mock('../../grinding-planning-board/state.js', () => ({ ensurePlanningBoardState: vi.fn(), stateOrder: (state: { seibanOrder: string[] }) => state.seibanOrder }));
vi.mock('../../grinding-planning-board/source.js', () => ({ readOverrides: vi.fn(), readRanks: vi.fn(), readRowDetails: vi.fn(), readWinnerRowsByFseibans: vi.fn(), readWinnerRowsByLogicalKeyFseibans: vi.fn() }));
vi.mock('../../policies/resource-category-policy.service.js', () => ({ getResourceCategoryPolicy: vi.fn(), isProductionScheduleCuttingResourceCd: () => true }));
vi.mock('../../fkojunst-status-mail-critical-lock.js', () => ({ acquireFkojunstStatusMailCriticalTransactionLock: vi.fn() }));
vi.mock('../../order-assignment/production-schedule-parent-row-lock.service.js', () => ({ acquireProductionScheduleParentRowLockInTransaction: vi.fn() }));
vi.mock('../piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../piece-key.js')>(),
  acquireSessakuPieceLogicalLocks: vi.fn(), acquireSessakuPieceBoardStateLocks: vi.fn(),
  findSessakuPieceWinner: vi.fn(), readSessakuPieceSet: vi.fn(), readSessakuPieceSets: vi.fn()
}));

const key = { fseiban: 'ORDER', fhincd: 'PART', fsigencd: '1', fkojun: '1' };
const parentId = sessakuPieceParentItemId(key);
const row = { id: 'source', rowData: { FSEIBAN: key.fseiban, FHINCD: key.fhincd, FSIGENCD: key.fsigencd, FKOJUN: key.fkojun }, updatedAt: new Date(0) };
const detail = { updatedAt: new Date(0), rowNotes: [], orderSupplements: [{ plannedQuantity: 5, plannedEndDate: null }], productionScheduleProgress: null, productionScheduleExternalCompletion: null };
const inboundRow = { fseiban: 'NEIGHBOUR', fhincd: 'OTHER', fsigencd: '2', fkojun: '9' };
const inboundPiece = { fseiban: 'NEIGHBOUR', fhincd: 'PIECE', fsigencd: '2', fkojun: '8' };
const sites = ['one', 'two', 'three', 'four'];
const stop = new Error('stop before loading scoped rows');

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
  vi.mocked(acquireSessakuPieceLogicalLocks).mockResolvedValue(new Set([JSON.stringify(Object.values(key))]));
  vi.mocked(findSessakuPieceWinner).mockResolvedValue(row);
  vi.mocked(readWinnerRowsByLogicalKeyFseibans).mockResolvedValue([row]);
  vi.mocked(readRowDetails).mockResolvedValue(new Map([[row.id, detail]]));
  vi.mocked(readRanks).mockResolvedValue({ rows: new Map() });
});
afterEach(() => vi.unstubAllEnvs());

describe('sessaku affected lane discovery', () => {
  it.each(['first-split', 'resplit', 'merge', 'null-lane'] as const)('includes inherited, own, inbound and per-site lanes for %s', async (action) => {
    const set = action === 'first-split' ? null : {
      id: 'set', ...key, version: 1, plannedQuantity: 5, quantityWarning: null,
      pieces: [{ id: 'a', quantity: 2, position: 1, isCompleted: false }, { id: 'b', quantity: 3, position: 2, isCompleted: false }]
    } as SessakuPieceSet;
    vi.mocked(readSessakuPieceSet).mockResolvedValue(set);
    const pieceSets = new Map(set ? [[JSON.stringify(Object.values(key)), set]] : []);
    vi.mocked(readSessakuPieceSets).mockResolvedValue(pieceSets);
    const overrides = sites.flatMap((siteKey, index) => [
      { siteKey, itemKey: parentId, overrideResourceCd: index % 2 === 0 ? '3' : '4' },
      ...(set ? [{ siteKey, itemKey: 'piece:a', overrideResourceCd: action === 'null-lane' ? '\t ' : index % 2 === 0 ? null : '5' }] : []),
      { siteKey, itemKey: sessakuPieceParentItemId(inboundRow), overrideResourceCd: action === 'null-lane' ? ' ' : '3' },
      { siteKey, itemKey: 'piece:inbound', overrideResourceCd: action === 'null-lane' ? ' ' : '5' },
      { siteKey, itemKey: sessakuPieceParentItemId({ ...inboundRow, fkojun: '7' }), overrideResourceCd: '99' }
    ].map((override) => ({ ...override, id: override.itemKey, version: 1, overrideDueDate: null, dueDateCleared: null,
      alternateRank: null, orderPinned: false, specialDueKind: null, specialDueExpiresAt: null, updatedAt: new Date(0) }) as ProductionScheduleGrindingPlanningBoardOverride));
    vi.mocked(readOverrides).mockImplementation(async (_client, siteKey) => new Map(overrides.filter((o) => o.siteKey === siteKey).map((o) => [o.itemKey, o])));
    const states = sites.map((siteKey) => ({ siteKey, seibanOrder: [key.fseiban, inboundRow.fseiban] }));
    const pieceLookup = vi.fn().mockResolvedValue([{ pieceSet: inboundPiece }]);
    const tx = {
      $queryRaw: vi.fn(),
      productionScheduleGrindingPlanningBoardState: { findMany: vi.fn().mockResolvedValue(states), findUniqueOrThrow: vi.fn().mockResolvedValue(states[0]) },
      productionScheduleGrindingPlanningBoardOverride: { findMany: vi.fn(async (query) => {
        if (query.select?.siteKey) return sites.map((siteKey) => ({ siteKey }));
        if (query.where.itemKey) return overrides.filter((o) => query.where.itemKey.in.includes(o.itemKey));
        return overrides.filter((o) => o.overrideResourceCd != null);
      }) },
      productionScheduleGrindingPlanningBoardResourceMinutesSource: { findMany: vi.fn().mockResolvedValue([]) },
      productionScheduleGrindingPlanningBoardResourcePartMinutes: { findMany: vi.fn().mockResolvedValue([]) },
      productionScheduleGrindingPlanningBoardResourceCapacity: { findMany: vi.fn().mockResolvedValue([]) },
      productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) },
      productionScheduleSessakuPieceOpCompletion: { findFirst: vi.fn().mockResolvedValue(null) },
      productionScheduleSessakuPiece: { findMany: pieceLookup }
    };
    vi.mocked(prisma.$transaction).mockImplementation((async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)) as never);
    let scope: SessakuLaneSourceScope | undefined;
    vi.mocked(readWinnerRowsByFseibans).mockImplementation(async (_client, _fseibans, laneScope) => {
      if (laneScope) { scope = laneScope; throw stop; }
      return [row];
    });
    const input = { rows: [row], details: new Map([[row.id, detail]]), ranks: { rows: new Map() }, pieceSets,
      overrides: new Map(overrides.filter((o) => o.siteKey === sites[0]).map((o) => [o.itemKey, o])), seibanOrder: [key.fseiban], category: 'all' as const };
    const current = projectGrindingPlanningBoard({ ...input, includePieces: Boolean(set) }).items;
    const params = { siteKey: sites[0], parentItemId: parentId, expectedPieceSetVersion: set?.version ?? 0, audit: { action: 'split' } };
    const pending = action === 'merge'
      ? mergeSessakuPieces({ ...params, pieceIds: ['a', 'b'], itemRevisions: Object.fromEntries(current.map((item) => [item.itemId, item.itemRevision])) })
      : splitSessakuPieces({ ...params, targetPieceId: set ? 'a' : undefined, itemRevision: current.find((item) => item.itemId === (set ? 'piece:a' : parentId))!.itemRevision,
        quantities: set ? [1, 1] : [2, 3] });
    await expect(pending).rejects.toBe(stop);
    expect(scope?.targetFseiban).toBe(key.fseiban);
    expect(new Set(scope?.resourceCds)).toEqual(new Set(action === 'first-split' ? ['3', '4'] : action === 'merge' ? ['1', '3', '4', '5'] : action === 'null-lane' ? [] : ['1', '5']));
    const keys = scope!.inboundKeys;
    expect(keys).not.toContainEqual({ ...inboundRow, fkojun: '7' });
    if (action === 'first-split' || action === 'merge' || action === 'null-lane') expect(keys).toContainEqual(inboundRow);
    else expect(keys).not.toContainEqual(inboundRow);
    if (action !== 'first-split') {
      expect(keys).toContainEqual(inboundPiece);
      expect(pieceLookup.mock.calls[0][0].where.id.in.sort()).toEqual(['a', 'inbound']);
    } else expect(pieceLookup).not.toHaveBeenCalled();
  });
});
