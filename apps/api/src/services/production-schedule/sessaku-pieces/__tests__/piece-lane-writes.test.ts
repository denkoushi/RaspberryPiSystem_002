import { describe, expect, it, vi } from 'vitest';
import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride as Override } from '@prisma/client';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { projectGrindingPlanningBoard, sortGrindingPlanningBoardProjectionItems } from '../../grinding-planning-board-projection.js';
import { createLaneWrites, flushSiteItems, replaceSiteItems, type LaneReplacementState } from '../piece-lane-writes.js';
import type { PieceAuditContext } from '../piece-audit.js';
import { sessakuPieceParentItemId } from '../piece-key.js';
import { legacyReplaceSiteItems } from './legacy-site-items.js';

const key = { fseiban: 'lot', fhincd: 'part', fsigencd: '10', fkojun: '100' };
const parent = sessakuPieceParentItemId(key);
const override = (itemKey: string, alternateRank: number | null, extra: Partial<Override> = {}): Override => ({
  id: itemKey, csvDashboardId: 'production-schedule', siteKey: 'site', itemKey, alternateRank,
  overrideResourceCd: null, overrideDueDate: null, dueDateCleared: null, orderPinned: false,
  specialDueKind: null, specialDueExpiresAt: null, version: 7, createdAt: new Date(0), updatedAt: new Date(0), ...extra
});
const item = (itemId: string, resource: string | null = '10', isCompleted = false): GrindingPlanningBoardItem => ({
  itemId, kind: 'row', fseiban: 'lot', productNo: '1', fhincd: itemId, processOrder: '100',
  effectiveResourceCd: resource, originalResourceCd: resource, isCompleted, alternateRank: null,
  originalRank: null, effectiveDueDate: null, originalDueDate: null
} as GrindingPlanningBoardItem);
const state = (pieces: GrindingPlanningBoardItem[], rows: Override[]): LaneReplacementState => {
  const overrides = new Map(rows.map((row) => [row.itemKey, row]));
  const projected = pieces.map((piece) => {
    const own = overrides.get(piece.itemId);
    return { ...piece, alternateRank: own?.alternateRank ?? piece.alternateRank,
      effectiveDueDate: own?.overrideDueDate?.toISOString().slice(0, 10) ?? piece.effectiveDueDate,
      orderPinned: own?.orderPinned ?? false,
      specialDue: (own?.specialDueKind === 'today' || own?.specialDueKind === 'overnight') && own.specialDueExpiresAt
        ? { kind: own.specialDueKind, expiresAt: own.specialDueExpiresAt.toISOString() } : null };
  });
  return { pieces: projected, overrides, seibanOrder: ['lot'], stateVersionIncrements: 0, laneWrites: createLaneWrites(overrides) };
};
const transaction = () => ({ $executeRaw: vi.fn().mockResolvedValue(1),
  productionScheduleGrindingPlanningBoardOverride: { deleteMany: vi.fn() } });
const audit = () => ({ action: 'split', timing: { laneRerankFallbackCount: 0, replaceSiteItemsCount: 0, rerankMs: 0 } } as PieceAuditContext);
const visible = (value: LaneReplacementState) => sortGrindingPlanningBoardProjectionItems(value.pieces.map((piece) => ({
  ...piece, alternateRank: value.overrides.get(piece.itemId)?.alternateRank ?? piece.alternateRank
})), value.seibanOrder ?? [], 'resource', 'alternate').map((piece) => piece.itemId);
const attributes = (value: LaneReplacementState, id: string) => {
  const row = value.overrides.get(id);
  return { overrideResourceCd: row?.overrideResourceCd ?? null, overrideDueDate: row?.overrideDueDate ?? null,
    dueDateCleared: row?.dueDateCleared ?? null, orderPinned: row?.orderPinned ?? false,
    specialDueKind: row?.specialDueKind ?? null, specialDueExpiresAt: row?.specialDueExpiresAt ?? null };
};
const expectLegacy = (next: LaneReplacementState, legacy: LaneReplacementState) => {
  expect(visible(next)).toEqual(visible(legacy));
  for (const piece of next.pieces) expect(attributes(next, piece.itemId)).toEqual(attributes(legacy, piece.itemId));
};

describe('deferred lane writes', () => {
  it.each(['head', 'middle', 'tail'] as const)('inherits placement at the %s without touching neighbours', async (placement) => {
    const ids = placement === 'head' ? [parent, 'before', 'after'] : placement === 'middle' ? ['before', parent, 'after'] : ['before', 'after', parent];
    const rows = ids.map((id, i) => override(id, i + 1, id === parent ? {
      overrideResourceCd: '10', overrideDueDate: new Date('2026-11-10'), dueDateCleared: false,
      orderPinned: true, specialDueKind: 'today', specialDueExpiresAt: new Date('2026-11-11T12:34:56.789Z')
    } : {}));
    const next = state(ids.map((id) => item(id)), rows), legacy = state(next.pieces, rows), context = audit();
    const tx = transaction();
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [parent], ['piece:a', 'piece:b'], context);
    await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, key, legacy, 'site', [parent], ['piece:a', 'piece:b']);
    expectLegacy(next, legacy);
    expect(next.laneWrites.pending.size).toBe(2);
    expect(context.timing!.laneRerankFallbackCount).toBe(0);
    for (const id of ['before', 'after']) expect(next.overrides.get(id)).toBe(rows.find((r) => r.itemKey === id));
    tx.$executeRaw.mockClear();
    await flushSiteItems(tx as unknown as Prisma.TransactionClient, new Map([['site', next]]));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((tx.$executeRaw.mock.calls[0][0] as Prisma.Sql).values[4]).toEqual(['piece:a', 'piece:b']);
  });

  it.each([true, false])('preserves null ranks in a null resource lane (parent override=%s)', async (hasParent) => {
    const pieces = [item('before', null), item(parent, null), item('after', null)];
    // The no-rank order is determined by due date, then the usual identity ties.
    pieces.forEach((piece, i) => { piece.effectiveDueDate = `2026-11-${10 + i}`; });
    const rows = hasParent ? [override(parent, null, { orderPinned: true })] : [];
    const next = state(pieces, rows), legacy = state(pieces, rows), context = audit(), tx = transaction();
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [parent], ['piece:a', 'piece:b'], context);
    await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, key, legacy, 'site', [parent], ['piece:a', 'piece:b']);
    expectLegacy(next, legacy);
    expect(next.overrides.get('piece:a')?.alternateRank).toBeNull();
    expect(next.laneWrites.pending.size).toBe(2);
    expect(context.timing!.laneRerankFallbackCount).toBe(0);
  });

  it('compares consecutive splits, resplit and merge against dense order and preserves completed rows', async () => {
    const pieces = [item(parent), item('later-parent'), item('neighbour'), item('completed', '10', true), item('unaffected', 'other')];
    const rows = pieces.map((piece, i) => override(piece.itemId, i + 1));
    const next = state(pieces, rows), legacy = state(pieces, rows), context = audit(), tx = transaction();
    for (const [removed, replacements] of [
      [[parent], ['piece:a', 'piece:b']], [['later-parent'], ['piece:c', 'piece:d']],
      [['piece:a'], ['piece:e', 'piece:f']], [['piece:e', 'piece:f'], ['piece:g']],
      [['piece:g', 'piece:b'], [parent]]
    ]) {
      await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', removed, replacements, context);
      await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, key, legacy, 'site', removed, replacements);
      expectLegacy(next, legacy);
    }
    expect(next.overrides.get('completed')).toBe(rows[3]);
    expect(next.overrides.get('unaffected')).toBe(rows[4]);
    expect(next.stateVersionIncrements).toBe(5);
    tx.$executeRaw.mockClear();
    await flushSiteItems(tx as unknown as Prisma.TransactionClient, new Map([['site', next]]));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    const upsert = tx.$executeRaw.mock.calls[0][0] as Prisma.Sql;
    expect(upsert.sql).toContain('FROM unnest(');
    expect(upsert.values[4]).not.toContain('completed');
    expect(upsert.values[4]).not.toContain('piece:a');
  });

  it('falls back when inherited ties would change the order and skips unchanged fallback ranks', async () => {
    const pieces = [item('before'), item(parent), item('after')];
    // Inherited ties sort the replacements before before; dense ranks retain the insertion order.
    pieces[0].fhincd = 'z'; pieces[1].fhincd = 'a';
    const rows = [override('before', 1), override(parent, 1), override('after', 3)];
    const next = state(pieces, rows), legacy = state(pieces, rows), context = audit(), tx = transaction();
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [parent], ['piece:a', 'piece:b'], context);
    await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, key, legacy, 'site', [parent], ['piece:a', 'piece:b']);
    expectLegacy(next, legacy);
    expect(context.timing!.laneRerankFallbackCount).toBe(1);
    tx.$executeRaw.mockClear();
    await flushSiteItems(tx as unknown as Prisma.TransactionClient, new Map([['site', next]]));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((tx.$executeRaw.mock.calls[0][0] as Prisma.Sql).values[4]).toEqual(['piece:a', 'piece:b', 'after']);
  });

  it('falls back when dense ranks would cross a completed row', async () => {
    const pieces = [item(parent), item('completed', '10', true), item('after')];
    const rows = [override(parent, 1), override('completed', 2), override('after', 3)];
    const next = state(pieces, rows), legacy = state(pieces, rows), context = audit(), tx = transaction();
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [parent], ['piece:a', 'piece:b', 'piece:c'], context);
    await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, key, legacy, 'site', [parent], ['piece:a', 'piece:b', 'piece:c']);
    expectLegacy(next, legacy);
    expect(context.timing!.laneRerankFallbackCount).toBe(1);
    expect(next.overrides.get('completed')).toBe(rows[1]);
  });

  it('uses saved sibling positions before UUIDs through resplit and merge', async () => {
    const next = state([item(parent)], [override(parent, 5)]), context = audit(), tx = transaction();
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', [parent], ['piece:z', 'piece:a'], context,
      new Map([['piece:z', 1], ['piece:a', 2]]));
    expect(visible(next)).toEqual(['piece:z', 'piece:a']);
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', ['piece:z'], ['piece:y', 'piece:b'], context,
      new Map([['piece:y', 1], ['piece:b', 2], ['piece:a', 3]]));
    expect(visible(next)).toEqual(['piece:y', 'piece:b', 'piece:a']);
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', ['piece:y', 'piece:b'], ['piece:x'], context,
      new Map([['piece:x', 1]]));
    expect(visible(next)).toEqual(['piece:x', 'piece:a']);
    expect(context.timing!.laneRerankFallbackCount).toBe(0);
    expect([...next.overrides.values()].every((row) => row.alternateRank === 5)).toBe(true);
  });

  it('retains a site version increment when a merge requires no override writes', async () => {
    const rows = [override(parent, 1), override('piece:a', 1), override('piece:b', 1)];
    const next = state([item('piece:a'), item('piece:b')], rows), tx = transaction();
    await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, 'site', ['piece:a', 'piece:b'], [parent]);
    tx.$executeRaw.mockClear();
    await flushSiteItems(tx as unknown as Prisma.TransactionClient, new Map([['site', next]]));
    expect(next.stateVersionIncrements).toBe(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect((tx.$executeRaw.mock.calls[0][0] as Prisma.Sql).sql).toContain('DELETE');
  });
});

describe('production lane write cardinality', () => {
  it.each([5, 6])('writes only %i units per process in the 3315-row / four-site fixture', async (total) => {
    const resources = ['021', '10', '10', '305', '588', '589', 'MSZ', 'MSZ'];
    const orders = ['200', '200', '210', '210', '210', '210', '450', '460'];
    const seibans = Array.from({ length: 89 }, (_, i) => `PERF-${i}`);
    const targets = resources.map((resource, i) => ({ id: `target:${i}`, updatedAt: new Date(0), rowData: {
      FSEIBAN: 'lot', FHINCD: 'part', ProductNo: '123', FSIGENCD: resource, FKOJUN: orders[i]
    } }));
    const fillers = Array.from({ length: 3307 }, (_, i) => ({ id: `filler:${i}`, updatedAt: new Date(0), rowData: {
      FSEIBAN: seibans[i % 89], FHINCD: `PART-${i}`, ProductNo: String(1000 + i),
      FSIGENCD: i < 1800 ? ['021', '10', '305', '588', '589', 'MSZ'][i % 6] : `UNRELATED-${i % 40}`, FKOJUN: '100'
    } }));
    const rows = [...targets, ...fillers];
    const details = new Map(rows.map((row) => [row.id, { updatedAt: new Date(0), rowNotes: [], orderSupplements: [],
      productionScheduleProgress: null, productionScheduleExternalCompletion: null }]));
    const ranks = new Map<string, number>();
    const overrides = fillers.map((row) => {
      const rank = (ranks.get(row.rowData.FSIGENCD) ?? 0) + 1; ranks.set(row.rowData.FSIGENCD, rank);
      return override(sessakuPieceParentItemId({ fseiban: row.rowData.FSEIBAN, fhincd: row.rowData.FHINCD,
        fsigencd: row.rowData.FSIGENCD, fkojun: row.rowData.FKOJUN }), rank);
    });
    let writes = 0, fallbacks = 0;
    for (let site = 0; site < 4; site++) {
      const seibanOrder = [...seibans.slice(site * 10), ...seibans.slice(0, site * 10), 'lot'];
      const pieces = projectGrindingPlanningBoard({ rows, details, overrides: new Map(overrides.map((row) => [row.itemKey, row])),
        ranks: { rows: new Map() }, seibanOrder, category: 'all', view: 'resource' }).items;
      expect(pieces).toHaveLength(3315);
      const next = { ...state(pieces, overrides), seibanOrder }, legacy = { ...state(pieces, overrides), seibanOrder }, context = audit(), tx = transaction();
      for (const [i, target] of targets.entries()) {
        if (target.rowData.FSIGENCD === '305') continue;
        const processKey = { ...key, fsigencd: target.rowData.FSIGENCD, fkojun: target.rowData.FKOJUN };
        const parentId = sessakuPieceParentItemId(processKey);
        const replacements = Array.from({ length: total }, (_, position) => `piece:${i}:${position}`);
        await replaceSiteItems(tx as unknown as Prisma.TransactionClient, processKey, next, String(site), [parentId], replacements, context);
        await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, processKey, legacy, String(site), [parentId], replacements);
        expectLegacy(next, legacy);
      }
      tx.$executeRaw.mockClear();
      await flushSiteItems(tx as unknown as Prisma.TransactionClient, new Map([[String(site), next]]));
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      writes += ((tx.$executeRaw.mock.calls[0][0] as Prisma.Sql).values[4] as string[]).length;
      fallbacks += context.timing!.laneRerankFallbackCount;
    }
    expect(writes).toBe(total === 5 ? 140 : 168); // Previously 7,348 / 7,376.
    expect(fallbacks).toBe(0);
  });

  it.each(['head', 'tail'] as const)('writes 140 overrides across four sites for seven operations at the %s', async (placement) => {
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
    const tx = transaction();
    let writes = 0, fallbacks = 0;
    for (let site = 0; site < 4; site++) {
      const next = state(pieces, rows), legacy = state(pieces, rows), context = audit();
      for (const [i, target] of targets.entries()) {
        const replacements = Array.from({ length: 5 }, (_, position) => `piece:${i}:${position}`);
        await replaceSiteItems(tx as unknown as Prisma.TransactionClient, key, next, String(site), [target.itemId], replacements, context);
        await legacyReplaceSiteItems(tx as unknown as Prisma.TransactionClient, key, legacy, String(site), [target.itemId], replacements);
        expectLegacy(next, legacy);
      }
      const writer = transaction();
      await flushSiteItems(writer as unknown as Prisma.TransactionClient, new Map([[String(site), next]]));
      expect(writer.$executeRaw).toHaveBeenCalledTimes(1);
      const upsert = writer.$executeRaw.mock.calls[0][0] as Prisma.Sql;
      writes += (upsert.values[4] as string[]).length;
      fallbacks += context.timing!.laneRerankFallbackCount;
    }
    expect(writes).toBe(140); // Previously 17,768, including version-only updates.
    expect(fallbacks).toBe(0);
  });
});
