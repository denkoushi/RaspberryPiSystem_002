import { describe, expect, it } from 'vitest';

import {
  GANTT_EIGHT_HOURS_MINUTES,
  GANTT_FOOTER_CHIPS_EXTRA_PX,
  GANTT_MIN_ROW_HEIGHT_PX,
  GANTT_ROW_VERTICAL_PADDING_PX,
  GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX
} from '../gantt/leaderBoardGanttConstants';
import { computeGanttRowLayout, computeGanttSlotLayout } from '../gantt/leaderBoardGanttLayout';
import { parseLeaderBoardRequiredMinutes } from '../parseLeaderBoardRequiredMinutes';

const AVAILABLE_HEIGHT = 480;

describe('leaderBoardGanttLayout', () => {
  it('parseLeaderBoardRequiredMinutes normalizes invalid values to 0', () => {
    expect(parseLeaderBoardRequiredMinutes(undefined)).toBe(0);
    expect(parseLeaderBoardRequiredMinutes('')).toBe(0);
    expect(parseLeaderBoardRequiredMinutes('abc')).toBe(0);
    expect(parseLeaderBoardRequiredMinutes(-10)).toBe(0);
    expect(parseLeaderBoardRequiredMinutes('120')).toBe(120);
    expect(parseLeaderBoardRequiredMinutes(480)).toBe(480);
  });

  it('returns empty slot layout for zero rows', () => {
    const slot = computeGanttSlotLayout({ rows: [], availableWorkHeightPx: AVAILABLE_HEIGHT });
    expect(slot.rowLayouts).toEqual([]);
    expect(slot.totalEstimateHeightPx).toBe(0);
    expect(slot.containerMinHeightPx).toBe(AVAILABLE_HEIGHT);
    expect(slot.eightHourBoundaryY).toBe(AVAILABLE_HEIGHT - GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX);
    expect(slot.tickMarks.some((t) => t.kind === 'origin')).toBe(true);
    expect(slot.tickMarks.some((t) => t.kind === 'boundary')).toBe(true);
  });

  it('places 8H boundary near bottom when total required minutes are under 8H', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 30 }, { requiredMinutes: 60 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(slot.totalRequiredMinutes).toBe(90);
    expect(slot.containerMinHeightPx).toBe(AVAILABLE_HEIGHT);
    expect(slot.eightHourBoundaryY).toBe(AVAILABLE_HEIGHT - GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX);
    expect(slot.rowLayouts[0]?.workHeightPx).toBeCloseTo(30 * (AVAILABLE_HEIGHT / GANTT_EIGHT_HOURS_MINUTES), 5);
    expect(slot.rowLayouts[0]?.visualMinHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX);
    expect(slot.rowLayouts[1]?.visualMinHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX);
  });

  it('scales rows proportionally at exactly 8H total', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 240 }, { requiredMinutes: 240 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(slot.totalRequiredMinutes).toBe(480);
    expect(slot.rowLayouts[0]?.workHeightPx).toBeCloseTo(240, 5);
    expect(slot.rowLayouts[1]?.workHeightPx).toBeCloseTo(240, 5);
    expect(slot.containerMinHeightPx).toBeGreaterThanOrEqual(slot.totalEstimateHeightPx);
  });

  it('maps 8H boundary by work-time ratio when total exceeds 8H', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 480 }, { requiredMinutes: 480 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(slot.totalRequiredMinutes).toBe(960);
    expect(slot.pxPerMinute).toBeCloseTo(AVAILABLE_HEIGHT / 960, 5);
    expect(slot.eightHourBoundaryY).toBeLessThan(AVAILABLE_HEIGHT);
    expect(slot.eightHourBoundaryY).toBeGreaterThan(0);
  });

  it('prioritizes readability when many short rows exceed available height', () => {
    const rows = Array.from({ length: 10 }, () => ({ requiredMinutes: 30 }));
    const slot = computeGanttSlotLayout({ rows, availableWorkHeightPx: AVAILABLE_HEIGHT });

    expect(slot.totalEstimateHeightPx).toBeGreaterThan(AVAILABLE_HEIGHT);
    expect(slot.containerMinHeightPx).toBe(slot.totalEstimateHeightPx);
    for (const layout of slot.rowLayouts) {
      expect(layout.visualMinHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX);
    }
  });

  it('maps overflow tick boundaries across full scroll content height', () => {
    const rows = Array.from({ length: 10 }, () => ({ requiredMinutes: 30 }));
    const slot = computeGanttSlotLayout({ rows, availableWorkHeightPx: AVAILABLE_HEIGHT });

    const boundaryTick = slot.tickMarks.find((t) => t.kind === 'boundary');
    expect(boundaryTick).toBeDefined();
    expect(boundaryTick?.topPx).toBeGreaterThan(AVAILABLE_HEIGHT - GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX);
    expect(boundaryTick?.topPx).toBeLessThanOrEqual(
      slot.containerMinHeightPx - GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX
    );
  });

  it('adds footer chip extra to estimate only', () => {
    const base = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 5 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });
    const withChips = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 5, hasFooterChips: true }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(withChips.rowLayouts[0]?.workHeightPx).toBe(base.rowLayouts[0]?.workHeightPx);
    expect(withChips.rowLayouts[0]?.visualMinHeightPx).toBe(base.rowLayouts[0]?.visualMinHeightPx);
    expect(withChips.rowLayouts[0]?.estimateHeightPx - (base.rowLayouts[0]?.estimateHeightPx ?? 0)).toBe(
      GANTT_FOOTER_CHIPS_EXTRA_PX
    );
  });

  it('legacy computeGanttRowLayout keeps min visual height for small required minutes', () => {
    const layout = computeGanttRowLayout({ requiredMinutes: 0 });
    expect(layout.rowMinHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX);
    expect(layout.estimateHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX + GANTT_ROW_VERTICAL_PADDING_PX);
  });
});
