import { describe, expect, it } from 'vitest';

import {
  GANTT_FOOTER_CHIPS_EXTRA_PX,
  GANTT_MAX_ROW_HEIGHT_PX,
  GANTT_MIN_ROW_HEIGHT_PX,
  GANTT_ROW_VERTICAL_PADDING_PX
} from '../gantt/leaderBoardGanttConstants';
import {
  computeGanttEightHourTickPositions,
  computeGanttEightHourTickVisualPositions,
  computeGanttRowLayout,
  computeGanttTotalEstimateHeightPx
} from '../gantt/leaderBoardGanttLayout';
import { parseLeaderBoardRequiredMinutes } from '../parseLeaderBoardRequiredMinutes';

describe('leaderBoardGanttLayout', () => {
  it('parseLeaderBoardRequiredMinutes normalizes invalid values to 0', () => {
    expect(parseLeaderBoardRequiredMinutes(undefined)).toBe(0);
    expect(parseLeaderBoardRequiredMinutes('')).toBe(0);
    expect(parseLeaderBoardRequiredMinutes('abc')).toBe(0);
    expect(parseLeaderBoardRequiredMinutes(-10)).toBe(0);
    expect(parseLeaderBoardRequiredMinutes('120')).toBe(120);
    expect(parseLeaderBoardRequiredMinutes(480)).toBe(480);
  });

  it('uses min row height for small required minutes', () => {
    const layout = computeGanttRowLayout({ requiredMinutes: 0 });
    expect(layout.rowMinHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX);
    expect(layout.estimateHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX + GANTT_ROW_VERTICAL_PADDING_PX);
  });

  it('scales 480 minutes to min row height (8H baseline)', () => {
    const layout = computeGanttRowLayout({ requiredMinutes: 480 });
    expect(layout.rowMinHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX);
  });

  it('clamps huge values to max row height', () => {
    const layout = computeGanttRowLayout({ requiredMinutes: 999_999 });
    expect(layout.rowMinHeightPx).toBe(GANTT_MAX_ROW_HEIGHT_PX);
  });

  it('adds footer chip extra to estimate only', () => {
    const base = computeGanttRowLayout({ requiredMinutes: 5 });
    const withChips = computeGanttRowLayout({ requiredMinutes: 5, hasFooterChips: true });
    expect(withChips.rowMinHeightPx).toBe(base.rowMinHeightPx);
    expect(withChips.estimateHeightPx - base.estimateHeightPx).toBe(GANTT_FOOTER_CHIPS_EXTRA_PX);
  });

  it('computes 8H tick positions', () => {
    expect(computeGanttEightHourTickPositions(0)).toEqual([0]);
    expect(computeGanttEightHourTickPositions(200)).toEqual([0, 96, 192]);
    expect(computeGanttEightHourTickPositions(96)).toEqual([0]);
  });

  it('maps 8H ticks on work-time axis, excluding footer chip visual gap', () => {
    const rowWithChips = computeGanttRowLayout({ requiredMinutes: 5, hasFooterChips: true });
    const rowPlain = computeGanttRowLayout({ requiredMinutes: 5 });
    const layouts = [rowWithChips, rowPlain];

    expect(computeGanttEightHourTickVisualPositions(layouts)).toEqual([0, rowWithChips.rowMinHeightPx]);
    expect(rowWithChips.estimateHeightPx).toBeGreaterThan(rowWithChips.rowMinHeightPx);
  });

  it('sums row estimate heights', () => {
    const layouts = [
      computeGanttRowLayout({ requiredMinutes: 5 }),
      computeGanttRowLayout({ requiredMinutes: 480, hasFooterChips: true })
    ];
    expect(computeGanttTotalEstimateHeightPx(layouts)).toBe(
      layouts[0].estimateHeightPx + layouts[1].estimateHeightPx
    );
  });
});
