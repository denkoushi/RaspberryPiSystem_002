import { describe, expect, it } from 'vitest';

import { pieceLanePath, pieceLaneSides, pieceLaneY } from './PlanningBoardPieceLinks';

import type { LaneRow } from './PlanningBoardPieceLinks';

const row = (top: number): LaneRow => ({ left: 100, right: 700, barTop: top + 22, barBottom: top + 92, minY: top + 1, maxY: top + 140 });
const nums = (path: string) => path.match(/[ML] [-\d.]+ [-\d.]+/g)!.map(step => step.split(' ').slice(1).map(Number) as [number, number]);

describe('pieceLaneSides', () => {
  it('splits alternating parts into below and above', () => {
    const sides = pieceLaneSides([
      { part: 'Y', pane: 0, row: 0, left: 100 }, { part: 'Z', pane: 0, row: 0, left: 200 },
      { part: 'Y', pane: 0, row: 0, left: 300 }, { part: 'Z', pane: 0, row: 0, left: 400 },
      { part: 'Y', pane: 1, row: 0, left: 100 }
    ]);
    expect(sides.get('0|Y')).toEqual({ side: 'below', level: 0 });
    expect(sides.get('0|Z')).toEqual({ side: 'above', level: 0 });
    expect(sides.get('1|Y')).toEqual({ side: 'below', level: 0 });
  });

  it('staggers levels per side and repeats them past the cap', () => {
    const parts = Array.from({ length: 12 }, (_, i) => ({ part: `p${i}`, pane: 0, row: 0, left: i }));
    const sides = pieceLaneSides(parts);
    expect(sides.get('0|p0')!.level).toBe(0);
    expect(sides.get('0|p2')!.level).toBe(1);
    expect(sides.get('0|p10')!.level).toBe(1);
    expect(sides.get('0|p8')!.level).toBe(0);
  });
});

describe('pieceLanePath', () => {
  const base = { weight: 4.5, level: 0, fromX: 150, toX: 450 };

  it('keeps a same-row line out of the bars vertical range', () => {
    for (const side of ['below', 'above'] as const) {
      const r = row(0);
      const { path, ys } = pieceLanePath({ ...base, rows: [r], side, fromEdge: side === 'below' ? r.barBottom : r.barTop, toEdge: side === 'below' ? r.barBottom : r.barTop });
      const points = nums(path);
      expect(points).toHaveLength(4);
      const y = ys[0]!;
      expect(points[1]![1]).toBe(y);
      expect(points[2]![1]).toBe(y);
      expect(y < r.barTop || y > r.barBottom).toBe(true);
      expect(side === 'below' ? y > r.barBottom : y < r.barTop).toBe(true);
    }
  });

  it('enters and leaves the top edge on the above side', () => {
    const r = row(0);
    const { path } = pieceLanePath({ ...base, rows: [r], side: 'above', fromEdge: r.barTop, toEdge: r.barTop });
    const points = nums(path);
    expect(points[0]).toEqual([150, r.barTop]);
    expect(points.at(-1)).toEqual([450, r.barTop]);
  });

  it('wraps right edge to left edge per row for a link two rows ahead', () => {
    const rows = [row(0), row(100), row(200)];
    const { path, arrows, ys } = pieceLanePath({ ...base, rows, side: 'below', fromEdge: rows[0]!.barBottom, toEdge: rows[2]!.barBottom });
    expect(arrows).toEqual([{ x: 700, y: ys[0] }, { x: 700, y: ys[1] }]);
    expect(path.match(/M /g)).toHaveLength(3);
    const points = nums(path);
    expect(points).toContainEqual([700, ys[0]!]);
    expect(points).toContainEqual([100, ys[1]!]);
    expect(points).toContainEqual([700, ys[1]!]);
    expect(points).toContainEqual([100, ys[2]!]);
    expect(points).toContainEqual([450, ys[2]!]);
    expect(ys[1]! - ys[0]!).toBeCloseTo(100);
  });

  it('keeps lanes clear of the bar edge so a line reads as leaving the piece', () => {
    const row: LaneRow = { left: 0, right: 10, barTop: 34, barBottom: 104, minY: 0, maxY: 200 };
    expect(pieceLaneY(row, 'below', 0, 2.5)).toBe(112);
    expect(pieceLaneY(row, 'below', 1, 2.5)).toBe(119);
    // Above, the line sits one line width further out than the base offsets 7/13.
    expect(pieceLaneY(row, 'above', 0, 2.5)).toBe(24.5);
    expect(pieceLaneY(row, 'above', 1, 2.5)).toBe(18.5);
    expect(pieceLaneY(row, 'above', 0, 5)).toBe(20.75);
    // A thicker 4K line adds only its extra half, and deeper levels reuse the outermost lane.
    expect(pieceLaneY(row, 'below', 0, 5)).toBe(113.25);
    expect(pieceLaneY(row, 'below', 3, 2.5)).toBe(119);
  });

  it('never sits inside the bars when the gap is too small', () => {
    const tight: LaneRow = { left: 0, right: 10, barTop: 3, barBottom: 73, minY: 4, maxY: 70 };
    expect(pieceLaneY(tight, 'below', 3, 4.5)).toBeGreaterThan(73);
    expect(pieceLaneY(tight, 'above', 3, 4.5)).toBeLessThan(3);
  });
});
