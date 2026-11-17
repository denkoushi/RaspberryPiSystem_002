import { describe, expect, it } from 'vitest';

import { computeObjectContainLayout } from '../computeObjectContainLayout';
import {
  computePrintMarkerPosition,
  computePrintDimensionLines,
  markerPositionInObjectContainContainer
} from '../printMarkerLayout';

describe('printMarkerLayout', () => {
  it('maps marker ratios through object-contain image rect', () => {
    const layout = computeObjectContainLayout(800, 600, 1600, 1200)!;
    const position = markerPositionInObjectContainContainer(
      { xRatio: 0.5, yRatio: 0.5 },
      layout,
      800,
      600
    );

    expect(position.leftPercent).toBeCloseTo(50, 5);
    expect(position.topPercent).toBeCloseTo(50, 5);
  });

  it('accounts for letterboxing on wide containers', () => {
    const position = computePrintMarkerPosition({ xRatio: 0, yRatio: 0.5 }, 1000, 600, 400, 300);

    expect(position).not.toBeNull();
    expect(position!.leftPercent).toBeGreaterThan(0);
    expect(position!.topPercent).toBeCloseTo(50, 5);
  });

  it('accounts for letterboxing on tall containers', () => {
    const position = computePrintMarkerPosition({ xRatio: 1, yRatio: 0.5 }, 1000, 600, 1600, 1200);

    expect(position).not.toBeNull();
    expect(position!.leftPercent).toBeLessThan(100);
    expect(position!.topPercent).toBeCloseTo(50, 5);
  });
});

describe('print dimensions', () => {
  it('maps X/Y dimensions and extensions through contain margins and follows the tip', () => {
    const point = { id: 'dim', markerNo: 1, name: '幅', xRatio: 0.5, yRatio: 0.5, nominalRaw: '10',
      upperToleranceRaw: '', lowerToleranceRaw: '', testValue: '', calloutTipXRatio: 0.8, calloutTipYRatio: 0.7,
      calloutDims: [{ dir: 'x' as const, baseXRatio: 0.2, baseYRatio: 0.3, offsetRatio: 0.1 },
        { dir: 'y' as const, baseXRatio: 0.2, baseYRatio: 0.3, offsetRatio: 0.9 }] };
    const result = computePrintDimensionLines([point], 1000, 600, 400, 300);
    // Image is 800x600, offsetX=100.
    expect(result[0].lines[2]).toEqual({ x1Percent: 26, y1Percent: 10, x2Percent: 74, y2Percent: 10 });
    expect(result[1].lines[2]).toEqual({ x1Percent: 82, y1Percent: 30, x2Percent: 82, y2Percent: 70 });
    expect(result[0].lines[0].y2Percent).toBeLessThan(10);
    expect(result[1].lines[0].x2Percent).toBeGreaterThan(82);
    expect(computePrintDimensionLines([{ ...point, calloutTipXRatio: 0.9 }], 1000, 600, 400, 300)[0].lines[2].x2Percent).toBe(82);
    expect(computePrintDimensionLines([{ ...point, calloutTipYRatio: null }], 1000, 600, 400, 300)).toEqual([]);
    expect(computePrintDimensionLines([point], 0, 0, 400, 300)).toEqual([]);
  });
});
