import { describe, expect, it, vi } from 'vitest';
import { readPlanningTestBars } from '../grinding-planning-board/test-bars.js';
import { createLaneWrites, replaceSiteItems, type LaneReplacementState } from '../sessaku-pieces/piece-lane-writes.js';
import type { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardTestBar } from '@raspi-system/shared-types';

vi.mock('../grinding-planning-board/test-bars.js', async (original) => ({
  ...await original<typeof import('../grinding-planning-board/test-bars.js')>(), readPlanningTestBars: vi.fn()
}));
const normal = (itemId: string, alternateRank: number, isCompleted = false) => ({
  kind: 'row', itemId, effectiveResourceCd: '761', originalResourceCd: '761', alternateRank, isCompleted
} as GrindingPlanningBoardItem);
const testBar = (isCompleted = false): GrindingPlanningBoardTestBar => ({ kind: 'test', itemId: 'test:uuid', itemRevision: 'r1', version: 1,
  sequence: 1, name: 'テスト1', resourceCd: '761', minutes: 30, alternateRank: 2, isCompleted, completedAt: isCompleted ? '2026-11-11' : null, deletedAt: null });
const key = { csvDashboardId: 'board', fseiban: 'SEIBAN01', fhincd: 'A', fsigencd: '761', fkojun: '1' };
const transaction = {} as Prisma.TransactionClient;
const state = (): LaneReplacementState => { const overrides = new Map(); return {
  pieces: [normal('a', 1), normal('b', 3), normal('completed', 4, true)], overrides, stateVersionIncrements: 0, laneWrites: createLaneWrites(overrides)
}; };

describe('test bar lane replacements', () => {
  it('retains the slot across successive automatic splits and a merge in the same transaction', async () => {
    vi.mocked(readPlanningTestBars).mockResolvedValue({ testBars: [testBar()], nextTestBarSequence: 2 });
    const before = state();
    await replaceSiteItems(transaction, key, before, 'site', ['a'], ['piece:a1', 'piece:a2']);
    expect(before.testBarRanks?.get('test:uuid')).toBe(3);
    await replaceSiteItems(transaction, key, before, 'site', ['b'], ['piece:b1', 'piece:b2']);
    const mixed = [...before.pieces.filter((item) => !item.isCompleted), ...before.testBars!].sort((a, b) => a.alternateRank! - b.alternateRank!);
    expect(mixed.map((item) => item.itemId)).toEqual(['piece:a1', 'piece:a2', 'test:uuid', 'piece:b1', 'piece:b2']);
    expect(before.pieces.some((item) => item.itemId === 'completed')).toBe(true);
    await replaceSiteItems(transaction, key, before, 'site', ['piece:a1', 'piece:a2'], ['a']);
    expect(before.testBarRanks?.get('test:uuid')).toBe(2);
    expect(before.pieces.find((item) => item.itemId === 'piece:b1')?.alternateRank).toBe(3);
  });
  it('does not put a completed test back into an unfinished lane', async () => {
    vi.mocked(readPlanningTestBars).mockResolvedValue({ testBars: [testBar(true)], nextTestBarSequence: 2 });
    const before = state();
    await replaceSiteItems(transaction, key, before, 'site', ['a'], ['piece:a1', 'piece:a2']);
    expect(before.testBarRanks?.size).toBe(0);
    expect(before.pieces.map((item) => item.itemId)).toEqual(['piece:a1', 'piece:a2', 'b', 'completed']);
  });
});
