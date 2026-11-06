import { describe, expect, it } from 'vitest';

import { canReorderForwardBars, forwardItemDetails, forwardQueueWindow, forwardStartLabel } from './planningBoardForwardQueue';
import { dateToDay } from './planningBoardGanttLayout';

import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const item = (overrides: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'a', kind: 'row', itemRevision: 'r1', version: 1, sourceRowId: 'a',
  fseiban: '26-1001', fhincd: 'P1', fhinmei: '部品', machineName: '機種', productNo: '1', processOrder: '10',
  originalResourceCd: '305', effectiveResourceCd: null, originalDueDate: '2026-10-16', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 1, requiredMinutes: 480, lslhSurface: false, requiredMinutesKnown: true,
  isCompleted: false, progress: { completed: 0, total: 1, quantityKnown: true }, ...overrides
});
const today = dateToDay('2026-10-14');
const bar = (id: string, start = today, overrides: Partial<GanttBar> = {}): GanttBar => ({
  item: item({ itemId: id }), start, end: start + 1, partKey: id, resource: '305', due: null,
  unknown: false, tone: 'planned', overlaps: [], flagged: false, ...overrides
});
const layout = (bars: GanttBar[]): GanttLayout => ({
  today, start: today, end: today + 2, overlapCount: 0, mode: 'forward',
  groups: bars.map((entry) => ({ key: entry.item.itemId, label: '', resource: null,
    rows: [{ key: entry.item.itemId, label: '', detail: '', bars: [entry], connectors: [], flagged: false }] }))
});

describe('forward queue helpers', () => {
  it('sorts across rows, excludes other resources/completed/unplanned bars, and does not mutate input', () => {
    const entries = [bar('later', today + 1), bar('other', today, { resource: '999' }),
      bar('completed', today, { item: item({ itemId: 'completed', isCompleted: true }) }),
      bar('unplanned', today, { start: null }), bar('first')];
    const result = forwardQueueWindow(layout(entries), entries[0]!);
    expect(result.map(({ bar, position }) => [bar.item.itemId, position])).toEqual([['first', 1], ['later', 2]]);
    expect(entries[0]!.item.itemId).toBe('later');
  });
  it('clamps the start to zero and does not backfill at the queue end', () => {
    const entries = Array.from({ length: 12 }, (_, i) => bar(String(i), today + i / 24));
    expect(forwardQueueWindow(layout(entries), entries[0]!)).toHaveLength(8);
    expect(forwardQueueWindow(layout(entries), entries[5]!).map(({ position }) => position)).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
    expect(forwardQueueWindow(layout(entries), entries[11]!).map(({ position }) => position)).toEqual([10, 11, 12]);
    expect(forwardQueueWindow(layout(entries), bar('missing'))).toEqual([]);
  });
  it('omits null/empty parts and preserves zero quantity', () => {
    expect(forwardItemDetails(item())).toBe('26-1001 · P1 · 1個 · 機種');
    expect(forwardItemDetails(item({ plannedQuantity: null, machineName: ' ' }))).toBe('26-1001 · P1');
    expect(forwardItemDetails(item({ fseiban: '', fhincd: '', plannedQuantity: 0, machineName: null }))).toBe('0個');
    expect(forwardItemDetails(item({ machineName: 'ｐｓｇ６３　ａ' }))).toBe('26-1001 · P1 · 1個 · PSG63 A');
  });
  it('formats the start with weekday and uses the first segment of a bar split by breaks', () => {
    const friday = dateToDay('2026-11-06');
    expect(forwardStartLabel(bar('a', friday + (8 * 60 + 30) / 1440))).toBe('11/06(金) 08:30');
    expect(forwardStartLabel(bar('b', friday + 0.9, { segments: [{ start: friday + 1 + 13 / 24, end: friday + 1.6 }, { start: friday + 1.7, end: friday + 1.8 }] })))
      .toBe('11/07(土) 13:00');
    expect(forwardStartLabel(bar('c', friday + (9 * 60 + 15) / 1440 - 1e-9))).toBe('11/06(金) 09:15');
    expect(forwardStartLabel(bar('d', null as unknown as number))).toBeNull();
  });

  it('allows only different unfinished jobs of the same resource and special-due band', () => {
    const source = bar('source');
    expect(canReorderForwardBars(source, bar('target'))).toBe(true);
    expect(canReorderForwardBars(source, source)).toBe(false);
    expect(canReorderForwardBars(source, bar('target', today, { resource: '999' }))).toBe(false);
    const completed = bar('completed', today, { item: item({ itemId: 'completed', isCompleted: true }) });
    expect(canReorderForwardBars(source, completed)).toBe(false);
    expect(canReorderForwardBars(completed, source)).toBe(false);
    const special = bar('special', today, { item: item({ itemId: 'special', specialDue: { kind: 'today', expiresAt: '2026-10-14T15:00:00Z' } }) });
    expect(canReorderForwardBars(source, special)).toBe(false);
    expect(canReorderForwardBars(special, { ...special, item: { ...special.item, itemId: 'same-band' } })).toBe(true);
  });
});
