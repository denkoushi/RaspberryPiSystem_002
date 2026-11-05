import { describe, expect, it } from 'vitest';

import { forwardLaterQueue } from './forwardLaterQueue';
import { dateToDay } from './planningBoardGanttLayout';

import type { GanttBar } from './planningBoardGanttLayout';
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

describe('forwardLaterQueue', () => {
  it('excludes completed, unplanned, visible and exact-boundary bars and sorts without mutating', () => {
    const entries = [bar('last', today + 2), bar('boundary', today + 1), bar('visible', today),
      bar('done', today + 3, { item: item({ isCompleted: true }) }), bar('unknown-start', today, { start: null }),
      bar('next', today + 1.5)];
    const result = forwardLaterQueue(entries, today + 1);
    expect(result.count).toBe(2);
    expect(result.bars.map((bar) => bar.item.itemId)).toEqual(['next', 'last']);
    expect(entries[0]!.item.itemId).toBe('last');
    expect(forwardLaterQueue(entries, today + 4)).toEqual({ count: 0, bars: [] });
  });
  it('uses the first segment as the actual start', () => {
    const split = bar('split', today, { segments: [{ start: today + 2, end: today + 3 }] });
    expect(forwardLaterQueue([split], today + 1).count).toBe(1);
    expect(forwardLaterQueue([split], today + 2).count).toBe(0);
  });
});
