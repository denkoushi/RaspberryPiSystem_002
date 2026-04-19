import { describe, expect, it } from 'vitest';

import {
  layoutSupplyTreemap,
  squarifyLayout,
  treemapSeverity,
} from '../loan-report-treemap-layout.js';

describe('treemapSeverity', () => {
  it('uses ratio squared with floor 0.08', () => {
    expect(treemapSeverity(0, 10)).toBe(0.08);
    expect(treemapSeverity(5, 10)).toBe(0.25);
    expect(treemapSeverity(10, 10)).toBe(1);
  });
});

describe('squarifyLayout', () => {
  it('lays out a single cell to full rect', () => {
    const r = squarifyLayout([{ v: 1, data: 'a' }], 0, 0, 100, 50);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ x: 0, y: 0, w: 100, h: 50, data: 'a' });
  });

  it('fills area with two cells', () => {
    const r = squarifyLayout(
      [
        { v: 2, data: 'a' },
        { v: 1, data: 'b' },
      ],
      0,
      0,
      100,
      100
    );
    expect(r).toHaveLength(2);
    const sumArea = r.reduce((s, x) => s + x.w * x.h, 0);
    expect(sumArea).toBeCloseTo(10000, 5);
  });
});

describe('layoutSupplyTreemap', () => {
  it('returns cell rects for TOP名寄せ rows', () => {
    const { cellRects, sectorRect } = layoutSupplyTreemap([
      { name: 'A', o: 2, t: 4 },
      { name: 'B', o: 1, t: 3 },
    ]);
    expect(sectorRect.w).toBeGreaterThan(0);
    expect(cellRects.length).toBe(2);
    for (const c of cellRects) {
      expect(c.w).toBeGreaterThan(0);
      expect(c.h).toBeGreaterThan(0);
    }
  });
});
