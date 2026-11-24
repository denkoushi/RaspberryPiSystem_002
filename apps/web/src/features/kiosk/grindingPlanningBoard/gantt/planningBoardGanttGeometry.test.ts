import { describe, expect, it } from 'vitest';

import { productionFixture } from '../__perf__/fixture';

import { planningBoardChainPositions } from './PlanningBoardChainLinks';
import { ganttBarGeometry } from './planningBoardGanttGeometry';
import { buildPlanningBoardGanttLayout, isNormalGanttBar } from './planningBoardGanttLayout';

const fixture = productionFixture(2, 1);
const layout = buildPlanningBoardGanttLayout({ ...fixture.options, mode: 'forward' });
const bars = layout.groups.flatMap(group => group.rows.flatMap(row => row.bars)).filter(isNormalGanttBar);

describe('forward vertical geometry', () => {
  it.each([1, 2, 5])('scales top/height without changing horizontal geometry (k=%s)', k => {
    const bar = bars[0]!;
    const base = ganttBarGeometry(bar, layout.start, 300, true)!;
    expect(ganttBarGeometry(bar, layout.start, 300, true, false, false, k)).toEqual({ ...base, top: 11 * k, height: 70 * k });
    expect(ganttBarGeometry(bar, layout.start, 300, true, true, true, k)).toMatchObject({ top: 34 * k, height: 70 * k });
    expect(ganttBarGeometry(bar, layout.start, 300, false, false, false, k)).toEqual(ganttBarGeometry(bar, layout.start, 300, false));
  });
  it('uses each rendered row scale for both local and two-machine chain endpoints', () => {
    const content = document.createElement('div');
    const rows = new Map(bars.map((bar, i) => {
      const row = document.createElement('div');
      row.dataset.ganttVerticalScale = String(i + 2);
      row.getBoundingClientRect = () => ({ top: i * 400 } as DOMRect);
      return [bar.item.itemId, row] as const;
    }));
    const positions = planningBoardChainPositions({ content: { current: content }, rowElements: { current: rows },
      bars, barRows: new Map(bars.map(bar => [bar.item.itemId, bar.item.itemId])), labelWidth: 168,
      layout, dayWidth: 300, viewportWidth: 3840, viewportHeight: 2000 });
    bars.forEach((bar, i) => {
      expect(positions.get(bar.item.itemId)?.first.top).toBe(i * 400 + 11 * (i + 2));
      expect(positions.get(bar.item.itemId)?.last.height).toBe(70 * (i + 2));
    });
  });
});
