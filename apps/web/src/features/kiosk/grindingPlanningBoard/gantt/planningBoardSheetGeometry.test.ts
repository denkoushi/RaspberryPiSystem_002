import { describe, expect, it } from 'vitest';

import { planningBoardSharedBottomInset, planningBoardSheetGeometry } from './planningBoardSheetGeometry';

describe('planningBoardSheetGeometry', () => {
  it.each([
    { name: 'upper pane partially covered', height: 800, top: 40, bottom: 420, open: true, overlap: 260, inset: 324, stripBottom: 640 },
    { name: 'lower pane fully covered', height: 800, top: 420, bottom: 800, open: true, overlap: 380, inset: 380, stripBottom: 640 },
    { name: 'upper pane above capped sheet', height: 1200, top: 40, bottom: 420, open: true, overlap: 0, inset: 64, stripBottom: 780 },
    { name: 'lower pane with capped sheet', height: 1200, top: 420, bottom: 1200, open: true, overlap: 760, inset: 780, stripBottom: 760 },
    { name: 'upper pane without sheet', height: 800, top: 40, bottom: 420, open: false, overlap: 0, inset: 64, stripBottom: 380 },
    { name: 'lower pane without sheet', height: 800, top: 420, bottom: 800, open: false, overlap: 0, inset: 64, stripBottom: 0 }
  ])('$name with an open chain strip', ({ height, top, bottom, open, overlap, inset, stripBottom }) => {
    const result = planningBoardSheetGeometry(height, top, bottom, open, 64);
    expect(result.sheetOverlap).toBeCloseTo(overlap);
    expect(result.bottomInset).toBeCloseTo(inset);
    expect(result.chainBottom).toBeCloseTo(stripBottom);
    expect(result.chainBottom).toBeGreaterThanOrEqual(result.sheetHeight);
    expect(height - result.chainBottom - 64).toBeGreaterThanOrEqual(0);
  });
});

describe('planningBoardSharedBottomInset', () => {
  it.each([
    { name: 'strip ends at pane top', top: 300, bottom: 600, sheet: 0, chainTop: 240, height: 60, inset: 0 },
    { name: 'strip above pane with sheet', top: 300, bottom: 600, sheet: 300, chainTop: 204, height: 60, inset: 300 },
    { name: 'strip starts at pane bottom', top: 40, bottom: 300, sheet: 0, chainTop: 300, height: 60, inset: 0 },
    { name: 'strip crosses pane top', top: 300, bottom: 600, sheet: 0, chainTop: 280, height: 60, inset: 300 },
    { name: 'strip inside pane', top: 40, bottom: 300, sheet: 0, chainTop: 240, height: 60, inset: 60 },
    { name: 'lower strip above sheet overlaps upper pane', top: 40, bottom: 300, sheet: 36, chainTop: 204, height: 60, inset: 96 }
  ])('$name', ({ top, bottom, sheet, chainTop, height, inset }) => {
    expect(planningBoardSharedBottomInset(top, bottom, sheet, chainTop, height)).toBe(inset);
  });
});
