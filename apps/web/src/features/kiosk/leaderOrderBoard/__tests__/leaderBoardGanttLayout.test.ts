import { describe, expect, it } from 'vitest';

import {
  GANTT_DEFAULT_CAPACITY_MINUTES,
  GANTT_EIGHT_HOURS_MINUTES,
  GANTT_FOOTER_CHIPS_EXTRA_PX,
  GANTT_MIN_ROW_HEIGHT_PX,
  GANTT_RULER_MAX_BAND_COUNT,
  GANTT_ROW_VERTICAL_PADDING_PX
} from '../gantt/leaderBoardGanttConstants';
import {
  computeGanttRowLayout,
  computeGanttSlotLayout,
  mapGanttTimeYToVisualY,
  normalizeRulerSegmentsForRenderHeight
} from '../gantt/leaderBoardGanttLayout';
import { parseLeaderBoardRequiredMinutes } from '../parseLeaderBoardRequiredMinutes';

const AVAILABLE_HEIGHT = 480;

function assertContiguousSegments(
  segments: readonly { topPx: number; heightPx: number }[],
  expectedEndPx: number
): void {
  expect(segments.length).toBeGreaterThan(0);
  for (const segment of segments) {
    expect(segment.heightPx).toBeGreaterThan(0);
  }
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1];
    const current = segments[index];
    expect(previous.topPx + previous.heightPx).toBeCloseTo(current.topPx, 5);
  }
  const last = segments[segments.length - 1];
  expect(last.topPx + last.heightPx).toBeCloseTo(expectedEndPx, 5);
}

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
    expect(slot.eightHourBoundaryEndY).toBe(AVAILABLE_HEIGHT);
    expect(slot.rulerSegments).toEqual([{ topPx: 0, heightPx: AVAILABLE_HEIGHT, bandIndex: 0 }]);
  });

  it('places first 8H segment to bottom when total required minutes are under 8H', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 30 }, { requiredMinutes: 60 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(slot.totalRequiredMinutes).toBe(90);
    expect(slot.containerMinHeightPx).toBe(AVAILABLE_HEIGHT);
    expect(slot.eightHourBoundaryEndY).toBe(AVAILABLE_HEIGHT);
    expect(slot.rulerSegments).toEqual([{ topPx: 0, heightPx: AVAILABLE_HEIGHT, bandIndex: 0 }]);
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
    expect(slot.rulerSegments).toHaveLength(1);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('keeps row scale compressed while the ruler stays capacity anchored', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 480 }, { requiredMinutes: 480 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(slot.totalRequiredMinutes).toBe(960);
    expect(slot.pxPerMinute).toBeCloseTo(AVAILABLE_HEIGHT / 960, 5);
    expect(slot.eightHourBoundaryEndY).toBe(AVAILABLE_HEIGHT);
    expect(slot.rulerHeightPx).toBe(960);
    expect(slot.rulerSegments).toHaveLength(2);
    expect(slot.rulerSegments[0]).toMatchObject({ topPx: 0, bandIndex: 0 });
    expect(slot.rulerSegments[1]).toMatchObject({ bandIndex: 1 });
    expect(slot.rulerSegments[0]?.heightPx).toBeCloseTo(slot.eightHourBoundaryEndY, 5);
    expect(slot.rulerSegments[0]?.topPx + (slot.rulerSegments[0]?.heightPx ?? 0)).toBeCloseTo(
      slot.rulerSegments[1]?.topPx ?? 0,
      5
    );
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('creates alternating bands for 16H total work', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 480 }, { requiredMinutes: 480 }, { requiredMinutes: 480 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(slot.totalRequiredMinutes).toBe(1440);
    expect(slot.rulerSegments).toHaveLength(3);
    expect(slot.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1, 2]);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('prioritizes readability when many short rows exceed available height', () => {
    const rows = Array.from({ length: 10 }, () => ({ requiredMinutes: 30 }));
    const slot = computeGanttSlotLayout({ rows, availableWorkHeightPx: AVAILABLE_HEIGHT });

    expect(slot.totalEstimateHeightPx).toBeGreaterThan(AVAILABLE_HEIGHT);
    expect(slot.containerMinHeightPx).toBe(slot.totalEstimateHeightPx);
    for (const layout of slot.rowLayouts) {
      expect(layout.visualMinHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX);
    }
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('maps overflow ruler segments across full scroll content height', () => {
    const rows = Array.from({ length: 10 }, () => ({ requiredMinutes: 30 }));
    const slot = computeGanttSlotLayout({ rows, availableWorkHeightPx: AVAILABLE_HEIGHT });
    const normalized = normalizeRulerSegmentsForRenderHeight(slot.rulerSegments, slot.containerMinHeightPx);

    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
    assertContiguousSegments(normalized, slot.containerMinHeightPx);
    expect(slot.rulerSegments[0]?.topPx).toBe(0);
    expect(slot.eightHourBoundaryEndY).toBeGreaterThan(0);
    expect(slot.eightHourBoundaryEndY).toBeLessThanOrEqual(slot.rulerHeightPx);
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
    assertContiguousSegments(withChips.rulerSegments, withChips.rulerHeightPx);
  });

  it('extends the last segment when render height exceeds logical ruler height', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 30 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });
    const normalized = normalizeRulerSegmentsForRenderHeight(slot.rulerSegments, 620);

    assertContiguousSegments(normalized, 620);
    expect(normalized[normalized.length - 1]?.heightPx).toBeGreaterThan(
      slot.rulerSegments[slot.rulerSegments.length - 1]?.heightPx ?? 0
    );
  });

  it('caps segment count for pathological required minutes', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 1_000_000 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(slot.rulerSegments.length).toBeLessThanOrEqual(GANTT_RULER_MAX_BAND_COUNT);
    expect(slot.rulerSegments.length).toBeLessThan(Math.ceil(slot.rulerHeightPx));
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('does not scale ruler segment count with rulerHeightPx', () => {
    const pathological = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 1_000_000 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });
    const longBacklog = computeGanttSlotLayout({
      rows: Array.from({ length: 200 }, () => ({ requiredMinutes: 480 })),
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });

    expect(longBacklog.rulerHeightPx).toBeGreaterThan(GANTT_RULER_MAX_BAND_COUNT * 10);
    expect(pathological.rulerSegments.length).toBeLessThanOrEqual(GANTT_RULER_MAX_BAND_COUNT);
    expect(longBacklog.rulerSegments.length).toBeLessThanOrEqual(GANTT_RULER_MAX_BAND_COUNT);
    expect(longBacklog.rulerSegments.length).toBeLessThan(Math.ceil(longBacklog.rulerHeightPx / 10));
    assertContiguousSegments(pathological.rulerSegments, pathological.rulerHeightPx);
    assertContiguousSegments(longBacklog.rulerSegments, longBacklog.rulerHeightPx);
  });

  it('keeps ruler boundary independent from compressed row layout', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 600 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT
    });
    const boundaryY = mapGanttTimeYToVisualY(slot.rowLayouts, GANTT_EIGHT_HOURS_MINUTES * slot.pxPerMinute);

    expect(boundaryY).toBeGreaterThan(0);
    expect(boundaryY).toBeLessThan(slot.rulerHeightPx);
    expect(slot.capacityBoundaryEndY).toBe(AVAILABLE_HEIGHT);
    expect(slot.eightHourBoundaryEndY).toBe(AVAILABLE_HEIGHT);
    expect(slot.capacityBoundaryEndY).toBeGreaterThan(boundaryY);
    expect(slot.rulerHeightPx).toBe(600);
    expect(slot.rulerSegments).toHaveLength(2);
    expect(slot.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1]);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('stretches only the ruler when required minutes increase but row minimum heights stay fixed', () => {
    const base = computeGanttSlotLayout({
      rows: Array.from({ length: 10 }, () => ({ requiredMinutes: 30 })),
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 480
    });
    const withLabor = computeGanttSlotLayout({
      rows: Array.from({ length: 10 }, () => ({ requiredMinutes: 60 })),
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 480
    });

    expect(withLabor.totalRequiredMinutes).toBeGreaterThan(base.totalRequiredMinutes);
    expect(withLabor.containerMinHeightPx).toBe(base.containerMinHeightPx);
    expect(withLabor.rulerHeightPx).toBeGreaterThan(base.rulerHeightPx);
    expect(withLabor.rowLayouts.map((layout) => layout.visualMinHeightPx)).toEqual(
      base.rowLayouts.map((layout) => layout.visualMinHeightPx)
    );
  });

  it('creates remainder band for 10H total at 8H capacity', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 600 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 480
    });

    expect(slot.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1]);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('creates three bands for 18H total at 8H capacity', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 1080 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 480
    });

    expect(slot.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1, 2]);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('does not add extra remainder band when total matches capacity multiples exactly', () => {
    const slot960 = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 960 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 480
    });
    expect(slot960.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1]);

    const slot1440 = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 1440 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 480
    });
    expect(slot1440.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1, 2]);
  });

  it('supports 12H capacity with remainder band', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 900 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 720
    });

    expect(slot.capacityMinutes).toBe(720);
    expect(slot.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1]);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('supports 24H capacity with remainder band', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 1500 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 1440
    });

    expect(slot.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1]);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('supports arbitrary capacity minutes such as 600', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 750 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 600
    });

    expect(slot.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1]);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('uses a taller ruler at 8H than 10H for the same required minutes', () => {
    const rows = [{ requiredMinutes: 1080 }];
    const slot8h = computeGanttSlotLayout({
      rows,
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 480
    });
    const slot10h = computeGanttSlotLayout({
      rows,
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 600
    });

    expect(slot8h.rulerHeightPx).toBeGreaterThan(slot10h.rulerHeightPx);
    expect(slot8h.capacityBoundaryEndY).toBe(AVAILABLE_HEIGHT);
    expect(slot10h.capacityBoundaryEndY).toBe(AVAILABLE_HEIGHT);
  });

  it('keeps last band color when footer chips extend non-time tail', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 600, hasFooterChips: true }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: 480
    });

    expect(slot.rulerSegments.length).toBeGreaterThanOrEqual(2);
    const lastBand = slot.rulerSegments[slot.rulerSegments.length - 1];
    expect(lastBand?.bandIndex).toBe(1);
    assertContiguousSegments(slot.rulerSegments, slot.rulerHeightPx);
  });

  it('uses default capacity when capacityMinutes is invalid', () => {
    const slot = computeGanttSlotLayout({
      rows: [{ requiredMinutes: 600 }],
      availableWorkHeightPx: AVAILABLE_HEIGHT,
      capacityMinutes: -1
    });

    expect(slot.capacityMinutes).toBe(GANTT_DEFAULT_CAPACITY_MINUTES);
    expect(slot.rulerSegments.map((segment) => segment.bandIndex)).toEqual([0, 1]);
  });

  it('legacy computeGanttRowLayout keeps min visual height for small required minutes', () => {
    const layout = computeGanttRowLayout({ requiredMinutes: 0 });
    expect(layout.rowMinHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX);
    expect(layout.estimateHeightPx).toBe(GANTT_MIN_ROW_HEIGHT_PX + GANTT_ROW_VERTICAL_PADDING_PX);
  });
});
