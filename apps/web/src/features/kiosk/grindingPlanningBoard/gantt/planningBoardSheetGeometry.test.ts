import { describe, expect, it } from 'vitest';

import { planningBoardSheetGeometry } from './planningBoardSheetGeometry';

describe('planningBoardSheetGeometry', () => {
  it.each([
    { name: 'upper pane partially covered', height: 800, top: 40, bottom: 420, open: true, overlap: 68, inset: 132, stripBottom: 448 },
    { name: 'lower pane fully covered', height: 800, top: 420, bottom: 800, open: true, overlap: 380, inset: 380, stripBottom: 448 },
    { name: 'upper pane above capped sheet', height: 1200, top: 40, bottom: 620, open: true, overlap: 0, inset: 64, stripBottom: 580 },
    { name: 'lower pane with capped sheet', height: 1200, top: 620, bottom: 1200, open: true, overlap: 520, inset: 580, stripBottom: 520 },
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
