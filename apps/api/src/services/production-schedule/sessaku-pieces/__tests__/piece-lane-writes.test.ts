import { describe, expect, it, vi } from 'vitest';
import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride as Override } from '@prisma/client';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { createLaneWrites, flushSiteItems, replaceSiteItems, type LaneReplacementState } from '../piece-lane-writes.js';
import { sessakuPieceParentItemId } from '../piece-key.js';
import { legacyReplaceSiteItems } from './legacy-site-items.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';

const key = { fseiban: 'lot', fhincd: 'part', fsigencd: '10', fkojun: '100' };
const parent = sessakuPieceParentItemId(key);
const override = (itemKey: string, alternateRank: number, extra: Partial<Override> = {}): Override => ({
  id: itemKey, csvDashboardId: 'production-schedule', siteKey: 'site', itemKey, alternateRank,
  overrideResourceCd: null, overrideDueDate: null, dueDateCleared: null, orderPinned: false,
  specialDueKind: null, specialDueExpiresAt: null, version: 7, createdAt: new Date(0), updatedAt: new Date(0), ...extra
});
const item = (itemId: string, resource: string | null = '10', isCompleted = false) =>
  ({ itemId, effectiveResourceCd: resource, isCompleted } as GrindingPlanningBoardItem);
const state = (pieces: GrindingPlanningBoardItem[], rows: Override[]): LaneReplacementState => {
  const overrides = new Map(rows.map((row) => [row.itemKey, row]));
  return { pieces, overrides, stateVersionIncrements: 0, laneWrites: createLaneWrites(overrides) };
};
const transaction = () => ({ $executeRaw: vi.fn().mockResolvedValue(1),
  productionScheduleGrindingPlanningBoardTestBar: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  productionScheduleGrindingPlanningBoardOverride: { deleteMany: vi.fn() } });

describe('deferred lane writes', () => {
  it('reranks replacements together with unfinished test bars and flushes their ranks', async () => {
    const next = state([{ ...item(parent), alternateRank: 1 }, { ...item('after'), alternateRank: 3 }], [override(parent, 1), override('after', 3)]);
    const tx = transaction();
    tx.productionScheduleGrindingPlanningBoardTestBar.findMany.mockResolvedValue([{
      id: 'test-id', sequence: 1, resourceCd: '10', minutes: 30, alternateRank: 2,
      version: 1, completedAt: null, deletedAt: null
    }]);
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [parent], ['piece:a', 'piece:b']);
    expect(next.overrides.get('piece:a')?.alternateRank).toBe(1);
    expect(next.overrides.get('piece:b')?.alternateRank).toBe(2);
    expect(next.testBarRanks?.get('test:test-id')).toBe(3);
    expect(next.overrides.get('after')?.alternateRank).toBe(4);
    await flushSiteItems(tx as unknown as Prisma.TransactionClient, new Map([['site', next]]));
    expect(tx.productionScheduleGrindingPlanningBoardTestBar.updateMany).toHaveBeenCalledWith({
      where: { id: 'test-id', csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: 'site', deletedAt: null },
      data: { alternateRank: 3, version: { increment: 1 } }
    });
  });

  it('matches legacy intermediate parent ranks and all override columns, incrementing repeated versions only once', async () => {
    const rows = [override(parent, 1, { overrideResourceCd: '10', overrideDueDate: new Date('2026-11-10'),
      dueDateCleared: false, orderPinned: true, specialDueKind: 'special', specialDueExpiresAt: new Date('2026-11-11T12:34:56.789Z') }),
    override('later-parent', 2), override('neighbour', 3), override('completed', 99), override('unaffected', 1)];
    const pieces = [item(parent), item('later-parent'), item('neighbour'), item('completed', '10', true), item('unaffected', 'other')];
    const next = state(pieces, rows), legacy = state(pieces, rows);
    const tx = transaction();
    for (const [removed, replacements] of [[parent, ['piece:a', 'piece:b']], ['later-parent', ['piece:c', 'piece:d']], ['piece:a', ['piece:e', 'piece:f']]] as const) {
      await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [removed], [...replacements]);
      await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, key, legacy, 'site', [removed], [...replacements]);
    }
    for (const [id, actual] of next.overrides) {
      const expected = legacy.overrides.get(id)!;
      const { id: _id, version: _version, createdAt: _created, updatedAt: _updated, ...columns } = actual;
      const { id: _oldId, version: _oldVersion, createdAt: _oldCreated, updatedAt: _oldUpdated, ...oldColumns } = expected;
      expect(columns).toEqual(oldColumns);
      expect(actual.version).toBe(next.laneWrites.pending.has(id) ? (next.laneWrites.original.get(id)?.version ?? 0) + 1 : expected.version);
    }
    expect([...next.overrides.keys()].sort()).toEqual([...legacy.overrides.keys()].sort());
    expect(next.overrides.get('later-parent')?.alternateRank).toBe(3);
    expect(next.overrides.get('piece:e')).toMatchObject({ orderPinned: true, dueDateCleared: false, specialDueKind: 'special' });
    expect(next.overrides.get('completed')).toBe(rows[3]);
    expect(next.stateVersionIncrements).toBe(legacy.stateVersionIncrements);
    const writer = transaction();
    await flushSiteItems(writer as unknown as Prisma.TransactionClient, new Map([['site', next]]));
    expect(writer.$executeRaw).toHaveBeenCalledTimes(2); // one upsert, one delete
    const upsert = writer.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    expect(upsert.sql).toContain('FROM unnest(');
    expect(upsert.values.length).toBe(12);
    expect(upsert.values[2]).not.toContain('piece:a');
    expect(upsert.values[2]).not.toContain('completed');
  });
  it('touches unchanged ranks with one version UPDATE and inserts missing overrides, including a null lane', async () => {
    const rows = [override('before', 1), override(parent, 2), override('completed', 9)];
    const next = state([item('before', null), item(parent, null), item('missing', null), item('completed', null, true)], rows);
    const tx = transaction();
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [parent], ['piece:a', 'piece:b']);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    await flushSiteItems(tx as unknown as Prisma.TransactionClient, new Map([['site', next]]));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const update = tx.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    expect(update.sql).toContain('SET "version" =');
    expect(update.sql).not.toContain('"alternateRank" =');
    expect(update.values).toContainEqual(['before']);
    const upsert = tx.$executeRaw.mock.calls[1][0] as Prisma.Sql;
    expect(upsert.values[4]).toEqual(['piece:a', 'piece:b', 'missing']);
    expect(next.overrides.get('before')?.version).toBe(8);
  });
});

describe('production lane write cardinality', () => {
  it.each(['head', 'tail'] as const)('retains intermediate parents and touches each row once for %s placement', async (placement) => {
    const resources = ['021', '10', '587', '10', 'MSZ', '584', '10'];
    const targets = resources.map((resource, i) => item(`parent:${i}`, resource));
    const fillers = ([['10', 2700], ['MSZ', 1360], ['587', 170], ['584', 100], ['021', 75], ['586', 89], ['26M', 82]] as const)
      .flatMap(([resource, count]) => Array.from({ length: count }, (_, i) => item(`${resource}:${i}`, resource)));
    const pieces = placement === 'head' ? [...targets, ...fillers] : [...fillers, ...targets];
    const ranks = new Map<string | null, number>();
    const rows = pieces.map((piece) => {
      const rank = (ranks.get(piece.effectiveResourceCd) ?? 0) + 1;
      ranks.set(piece.effectiveResourceCd, rank);
      return override(piece.itemId, rank);
    });
    const next = state(pieces, rows), legacy = state(pieces, rows);
    const tx = transaction();
    for (const [i, target] of targets.entries()) {
      const replacements = Array.from({ length: 5 }, (_, position) => `piece:${i}:${position}`);
      await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [target.itemId], replacements);
      await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, key, legacy, 'site', [target.itemId], replacements);
    }
    expect(next.laneWrites.pending.size * 4).toBe(17768);
    for (const [id, actual] of next.overrides) {
      const expected = legacy.overrides.get(id)!;
      expect(actual.alternateRank).toBe(expected.alternateRank);
      expect(actual.version).toBe(next.laneWrites.pending.has(id) ? (next.laneWrites.original.get(id)?.version ?? 0) + 1 : expected.version);
    }
    expect(next.pieces).toEqual(legacy.pieces);
    const writer = transaction();
    await flushSiteItems(writer as unknown as Prisma.TransactionClient, new Map([['site', next]]));
    expect(writer.$executeRaw).toHaveBeenCalledTimes(placement === 'head' ? 1 : 2);
    const upsert = writer.$executeRaw.mock.calls.at(-1)![0] as Prisma.Sql;
    expect((upsert.values[4] as string[]).length * 4).toBe(placement === 'head' ? 17768 : 148);
    if (placement === 'tail') {
      const update = writer.$executeRaw.mock.calls[0][0] as Prisma.Sql;
      expect((update.values[2] as string[]).length * 4).toBe(17620);
    }
  });
});
