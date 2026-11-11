import { describe, expect, it } from 'vitest';

import { planningBoardOrderMetrics } from './planningBoardAutoOrder';
import { buildForwardPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { mergeUnitOrderLane, planningBoardUnitOrder } from './planningBoardUnitOrder';

import type { GanttLayoutOptions } from './planningBoardGanttLayout';
import type { UnitOrderMethod } from './planningBoardUnitOrder';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const piece = (id: string, part: string, extra: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: id, kind: 'piece', itemRevision: id, version: 1, sourceRowId: id, parentItemId: `parent-${part}`,
  fseiban: id, fhincd: part, fhinmei: part, machineName: null, productNo: id, processOrder: '10',
  originalResourceCd: '021', effectiveResourceCd: null, originalDueDate: '2026-11-20', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 1, requiredMinutes: 100, unitRequiredMinutes: 100,
  requiredMinutesKnown: true, lslhSurface: false, isCompleted: false, completedOpNos: [],
  progress: { completed: 0, total: 1, quantityKnown: true }, ...extra
});
const options = (items: GrindingPlanningBoardItem[]): GanttLayoutOptions => ({
  items: items.map((item, index) => ({ ...item, alternateRank: index + 1 })), resources: ['021', '022', '023'],
  allocation: 'alternate', view: 'resource', seibanOrder: items.map(item => item.fseiban),
  dailyHoursByResource: {}, today: '2026-11-11', now: new Date('2026-11-11T08:00:00+09:00'), scale: 14
});
const run = (input: GanttLayoutOptions, method: UnitOrderMethod, resources = ['021', '022'],
  overrides: Partial<Parameters<typeof planningBoardUnitOrder>[3]> = {}) => planningBoardUnitOrder(input, resources, method, {
  visibleItemIds: new Set(input.items.map(item => item.itemId)), canMoveResource: () => true, hasPendingSeiban: () => false, ...overrides
});

describe('planningBoardUnitOrder', () => {
  it('groups parts by earliest due, then first current occurrence; sorts pieces by due and current order', () => {
    const input = options([piece('a-late', 'A'), piece('b-first', 'B'), piece('a-early', 'A', { effectiveDueDate: '2026-11-12' }),
      piece('b-second', 'B'), piece('none', 'C', { originalDueDate: null })]);
    expect(run(input, 'group').proposal['021']).toEqual(['a-early', 'a-late', 'b-first', 'b-second', 'none']);
    const ties = options([piece('b', 'B'), piece('a', 'A'), piece('b2', 'B')]);
    expect(run(ties, 'group').proposal['021']).toEqual(['b', 'b2', 'a']);
  });

  it('takes one piece per part on each round and skips exhausted parts', () => {
    const input = options([piece('a1', 'A'), piece('a2', 'A'), piece('a3', 'A'), piece('b1', 'B'), piece('b2', 'B'), piece('c', 'C')]);
    expect(run(input, 'round').proposal['021']).toEqual(['a1', 'b1', 'c', 'a2', 'b2', 'a3']);
  });

  it.each(['group', 'round', 'balance'] as const)('keeps rows, ordinary split pieces, pins, special due and hidden bars at the same indices (%s)', method => {
    const input = options([piece('a1', 'A'), piece('row', 'R', { kind: 'row' }), piece('b1', 'B'),
      piece('pin', 'P', { orderPinned: true }), piece('a2', 'A'),
      piece('special', 'S', { specialDue: { kind: 'today', expiresAt: '2026-11-11T10:00:00Z' } }),
      piece('split', 'T', { unitRequiredMinutes: undefined }), piece('hidden', 'H'), piece('b2', 'B'),
      piece('other', 'X', { originalResourceCd: '023' }), piece('done', 'D', { isCompleted: true })]);
    const result = run(input, method, ['021', '022'], { visibleItemIds: new Set(input.items.filter(item => item.itemId !== 'hidden').map(item => item.itemId)) });
    // Special-due sorting is part of the current lane order.
    const current = run(input, 'group', [] as string[]).proposal['021']!;
    for (const id of ['row', 'pin', 'special', 'split', 'hidden']) expect(result.proposal['021']!.indexOf(id)).toBe(current.indexOf(id));
    expect(result.proposal['023']).toEqual(['other']);
    expect(Object.values(result.proposal).flat()).not.toContain('done');
    expect(Object.values(result.proposal).flat().sort()).toEqual(input.items.filter(item => !item.isCompleted).map(item => item.itemId).sort());
  });

  it('assigns whole parts by due then total minutes, balancing fixed load and breaking ties toward the upper machine', () => {
    const input = options([piece('small', 'S', { unitRequiredMinutes: 20 }), piece('large1', 'L', { unitRequiredMinutes: 60 }),
      piece('large2', 'L', { unitRequiredMinutes: 60 }), piece('urgent', 'U', { originalDueDate: '2026-11-12', unitRequiredMinutes: 30 }),
      piece('fixed', 'F', { kind: 'row', originalResourceCd: '022', requiredMinutes: 50 })]);
    const result = run(input, 'balance');
    expect(result.proposal).toMatchObject({ '021': ['urgent', 'large1', 'large2'], '022': ['fixed', 'small'] });
    expect(result.resourceChanges).toEqual([{ itemId: 'small', resourceCd: '022', previousResourceCd: '021' }]);
  });

  it('includes setup once per assigned part and uses the destination machine setup time', () => {
    const input = options([piece('a', 'A', { unitRequiredMinutes: 10 }), piece('b', 'B', { unitRequiredMinutes: 20 }), piece('c', 'C', { unitRequiredMinutes: 5 })]);
    input.resourceMinutes = { ownSourceResourceCds: ['021', '022'], values: [
      { resourceCd: '021', fhincd: 'A', setupMinutes: 100 }, { resourceCd: '022', fhincd: 'A', setupMinutes: 100 }
    ] } as GanttLayoutOptions['resourceMinutes'];
    expect(run(input, 'balance').proposal).toMatchObject({ '021': ['a'], '022': ['b', 'c'] });
  });

  it('charges the setup of the chosen destination rather than the other machine', () => {
    const input = options([piece('fixed', 'F', { kind: 'row', requiredMinutes: 50 }), piece('a', 'A', { unitRequiredMinutes: 10 }),
      piece('b', 'B', { unitRequiredMinutes: 30 }), piece('c', 'C', { unitRequiredMinutes: 5 })]);
    input.resourceMinutes = { ownSourceResourceCds: ['021', '022'], values: [
      { resourceCd: '021', fhincd: 'A', setupMinutes: 100 }, { resourceCd: '022', fhincd: 'A', setupMinutes: 0 }
    ] } as GanttLayoutOptions['resourceMinutes'];
    expect(run(input, 'balance').proposal).toMatchObject({ '021': ['fixed'], '022': ['a', 'b', 'c'] });
  });

  it('includes the current setup duration of fixed unit bars in initial machine load', () => {
    const input = options([piece('fixed', 'F', { orderPinned: true, unitRequiredMinutes: 5 }),
      piece('a', 'A', { unitRequiredMinutes: 60 }), piece('b', 'B', { unitRequiredMinutes: 10 })]);
    input.resourceMinutes = { ownSourceResourceCds: ['021'], values: [{ resourceCd: '021', fhincd: 'F', setupMinutes: 100 }] } as GanttLayoutOptions['resourceMinutes'];
    expect(run(input, 'balance').proposal).toMatchObject({ '021': ['fixed'], '022': ['a', 'b'] });
  });

  it('combines movable siblings from both machines into the same part assignment', () => {
    const input = options([piece('a1', 'A'), piece('b', 'B', { unitRequiredMinutes: 20 }), piece('a2', 'A', { originalResourceCd: '022' })]);
    expect(run(input, 'balance').proposal).toMatchObject({ '021': ['a1', 'a2'], '022': ['b'] });
  });

  it('keeps forbidden and pending-seiban pieces on their machines and counts their processing load', () => {
    const input = options([piece('blocked', 'A', { unitRequiredMinutes: 150 }), piece('pending', 'B', { unitRequiredMinutes: 150 }), piece('move', 'C')]);
    const result = run(input, 'balance', ['021', '022'], {
      canMoveResource: item => item.itemId !== 'blocked', hasPendingSeiban: fseiban => fseiban === 'pending'
    });
    expect(result.proposal).toMatchObject({ '021': ['blocked', 'pending'], '022': ['move'] });
    expect(result.resourceChanges.map(change => change.itemId)).toEqual(['move']);
  });

  it('can receive a part on an initially empty machine without duplicating or dropping pieces', () => {
    const input = options([piece('a1', 'A'), piece('b1', 'B'), piece('a2', 'A'), piece('b2', 'B')]);
    const result = run(input, 'balance');
    expect(result.proposal).toMatchObject({ '021': ['a1', 'a2'], '022': ['b1', 'b2'] });
    expect(result.resourceChanges).toHaveLength(2);
    expect(run(input, 'group', ['021']).resourceChanges).toEqual([]);
  });

  it('retains enough pieces above a fixed bar to preserve its index when balancing would drain that lane', () => {
    const input = options([piece('a', 'A'), piece('row', 'R', { kind: 'row', requiredMinutes: 1000 })]);
    expect(run(input, 'balance').proposal).toMatchObject({ '021': ['a', 'row'], '022': [] });
  });

  it.each(['group', 'round', 'balance'] as const)('is deterministic and does not mutate inputs (%s)', method => {
    const input = options([piece('b1', 'B'), piece('a1', 'A'), piece('b2', 'B'), piece('a2', 'A')]);
    const original = structuredClone(input);
    expect(run(input, method)).toEqual(run(input, method));
    expect(input).toEqual(original);
  });

  it('counts bars with positive setup segments rather than fragments, and grouping reduces setups', () => {
    const input = options([piece('a1', 'A'), piece('b', 'B'), piece('a2', 'A')]);
    input.resourceMinutes = { ownSourceResourceCds: ['021'], values: [
      { resourceCd: '021', fhincd: 'A', setupMinutes: 15 }, { resourceCd: '021', fhincd: 'B', setupMinutes: 20 }
    ] } as GanttLayoutOptions['resourceMinutes'];
    expect(planningBoardOrderMetrics(buildForwardPlanningBoardGanttLayout(input), true).setupCount).toBe(3);
    expect(planningBoardOrderMetrics(buildForwardPlanningBoardGanttLayout({ ...input, laneOrder: run(input, 'group').proposal }), true).setupCount).toBe(2);
    expect(planningBoardOrderMetrics({ groups: [{ rows: [{ bars: [{ tone: 'planned', setupSegments: [{ start: 0, end: 1 }, { start: 2, end: 3 }] },
      { tone: 'planned', setupSegments: [{ start: 0, end: 0 }] }] }] }] } as Parameters<typeof planningBoardOrderMetrics>[0], true).setupCount).toBe(1);
  });
});

describe('mergeUnitOrderLane', () => {
  it('keeps hidden items in place, drops moved-out pieces and appends moved-in pieces', () => {
    expect(mergeUnitOrderLane(['a', 'h1', 'b', 'c', 'h2'], ['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'h1', 'a', 'h2']);
    expect(mergeUnitOrderLane(['h1', 'a', 'h2'], ['a'], ['x', 'a', 'y'])).toEqual(['h1', 'x', 'h2', 'a', 'y']);
  });
});
