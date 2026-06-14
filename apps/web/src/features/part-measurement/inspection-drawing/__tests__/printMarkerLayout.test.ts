import { describe, expect, it } from 'vitest';

import { computeObjectContainLayout } from '../computeObjectContainLayout';
import {
  computePrintMarkerPosition,
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
