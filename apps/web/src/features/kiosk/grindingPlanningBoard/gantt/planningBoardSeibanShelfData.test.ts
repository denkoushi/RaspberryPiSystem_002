import { describe, expect, it } from 'vitest';

import { buildPlanningBoardSeibanShelf } from './planningBoardSeibanShelfData';

import type { GanttBar } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const item = (itemId: string, values: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId, kind: 'piece', fseiban: 'S1', fhincd: 'P1', fhinmei: 'フランジ', machineName: 'MX-520', productNo: '1',
  processOrder: '10', plannedQuantity: 1, parentPlannedQuantity: 2, originalResourceCd: '021', effectiveResourceCd: null,
  originalDueDate: '2026-11-13', effectiveDueDate: null, ...values
} as GrindingPlanningBoardItem);
const colors = new Map([['S2', 'bg-amber-400'], ['S1', 'bg-sky-400']]);

describe('buildPlanningBoardSeibanShelf', () => {
  it('counts actual items on the displayed resources, including the second machine and deduplicating input', () => {
    const a = item('a'); const b = item('b', { originalResourceCd: '022' });
    const c = item('c', { originalResourceCd: null });
    const d = item('d', { originalResourceCd: '503', effectiveResourceCd: '021' });
    const single = buildPlanningBoardSeibanShelf([a, b, c, d, a], [], ['021'], colors)[0]!;
    expect(single).toMatchObject({ placed: 2, total: 4, model: 'MX-520', due: '2026-11-13' });
    expect(single.parts[0]!.units.flat().map(tile => [tile.resource, tile.placed])).toEqual([
      ['021', true], ['022', false], [null, false], ['021', true]
    ]);
    expect(buildPlanningBoardSeibanShelf([a, b, c, d], [], ['021', '022'], colors)[0]!.placed).toBe(3);
  });
  it('joins operation ranges by physical piece within a part, in operation order', () => {
    const first = item('first', { pieceId: 'u1', piecePosition: 1, opRange: { fromOpNo: 1, toOpNo: 2 } });
    const last = item('last', { pieceId: 'u1', piecePosition: 1, opRange: { fromOpNo: 3, toOpNo: 4 }, originalResourceCd: '503' });
    const second = item('second', { pieceId: 'u2', piecePosition: 2 });
    const result = buildPlanningBoardSeibanShelf([second, last, first], [], ['021'], colors)[0]!;
    expect(result.parts[0]!.units.map(unit => unit.map(tile => tile.item.itemId))).toEqual([['first', 'last'], ['second']]);
    expect(result.parts[0]!.quantity).toBe(2);
    expect(result).toMatchObject({ total: 3, placed: 2 });
  });
  it('follows color order, earliest effective due date, and scheduled lateness without mutating inputs', () => {
    const items = [item('a'), item('b', { fseiban: 'S2', effectiveDueDate: '2026-11-12' }), item('c', { fseiban: 'hidden' })];
    const bars = [{ item: items[1], tone: 'late' }] as GanttBar[];
    const result = buildPlanningBoardSeibanShelf(Object.freeze(items), bars, ['021'], colors);
    expect(result.map(column => column.seiban)).toEqual(['S2', 'S1']);
    expect(result[0]).toMatchObject({ late: true, due: '2026-11-12' });
    expect(result[0]!.parts[0]!.units[0]![0]!.late).toBe(true);
    expect(result[1]!.late).toBe(false);
  });
  it('keeps unassigned product numbers separate and handles missing quantities and empty input', () => {
    const unknownColors = new Map([['********', 'bg-slate-400']]);
    const items = ['1', '2'].map(productNo => item(productNo, { fseiban: '********', productNo, plannedQuantity: null, parentPlannedQuantity: null }));
    const result = buildPlanningBoardSeibanShelf(items, [], [], unknownColors);
    expect(result[0]!.parts).toHaveLength(2);
    expect(result[0]!.parts[0]!.quantity).toBeNull();
    expect(buildPlanningBoardSeibanShelf([], [], [], colors)).toEqual([]);
  });
});
