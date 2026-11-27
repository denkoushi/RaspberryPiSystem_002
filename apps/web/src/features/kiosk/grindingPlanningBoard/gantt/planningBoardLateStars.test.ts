import { describe, expect, it } from 'vitest';

import { dateToDay } from './planningBoardGanttLayout';
import { planningBoardSendOutRows } from './planningBoardLateStars';

import type { GanttBar, NormalGanttBar } from './planningBoardGanttLayout';

describe('planningBoardSendOutRows', () => {
  it('uses the earliest send-out date and sorts tied dates by planned start', () => {
    const bar = (itemId: string, fseiban: string, start: number, overrides: Partial<NormalGanttBar['item']> = {}): NormalGanttBar => ({
      item: { itemId, fseiban, kind: 'row', lslhSurface: true, isCompleted: false, ...overrides } as NormalGanttBar['item'],
      resource: '305', partKey: itemId, due: null, start, end: start + 1,
      unknown: false, tone: 'planned', overlaps: [], flagged: false
    });
    const dates = (...values: string[]) => ({ surfaceSendOutDates: values.map((date) => ({ date })) });
    const rows = new Map([
      ['A', dates('2026-11-16', '2026-11-12')],
      ['B', dates('2026-11-13')],
      ['C', dates()]
    ]);
    const early = bar('early', 'A', 1);
    const testBar = { ...early, item: { kind: 'test', itemId: 'test' } } as GanttBar;
    const list = planningBoardSendOutRows([
      bar('later', 'A', 3), bar('yesterday', 'B', 0), early, early, testBar,
      bar('no-dates', 'C', 0), bar('paint', 'A', 0, { lslhSurface: false }), bar('regrind', 'A', 0, { afterLslhSurface: true }),
      bar('complete', 'A', 0, { isCompleted: true }), { ...bar('completed-tone', 'A', 0), tone: 'completed' }
    ], rows);
    expect(list.map(({ bar, sendOutDay }) => [bar.item.itemId, sendOutDay])).toEqual([
      ['early', dateToDay('2026-11-12')], ['later', dateToDay('2026-11-12')], ['yesterday', dateToDay('2026-11-13')]
    ]);
  });
});
