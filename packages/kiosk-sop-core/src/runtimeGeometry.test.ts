import { describe, expect, it } from 'vitest';

import { computeContainedRect, computeLeaderSegment } from './runtimeGeometry.js';

describe('kiosk SOP runtime geometry', () => {
  it('centers a wide screen vertically inside a taller stage', () => {
    expect(computeContainedRect(950, 638, 1536, 864)).toEqual({
      left: 0,
      top: 51.8125,
      width: 950,
      height: 534.375
    });
  });

  it('centers a narrower screen horizontally inside a wide stage', () => {
    expect(computeContainedRect(1558, 910, 1280, 800)).toEqual({
      left: 51,
      top: 0,
      width: 1456,
      height: 910
    });
  });

  it('returns an empty rectangle for invalid dimensions', () => {
    expect(computeContainedRect(0, 638, 1536, 864)).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0
    });
  });

  it('joins the card right-center to the pin boundary', () => {
    const segment = computeLeaderSegment(
      { left: 100, top: 50, width: 1280, height: 638 },
      { left: 110, top: 70, width: 309, height: 56 },
      { left: 490, top: 84, width: 28, height: 28 }
    );

    expect(segment.start).toEqual({ x: 319, y: 48 });
    const pinCenter = { x: 404, y: 48 };
    expect(Math.hypot(segment.end.x - pinCenter.x, segment.end.y - pinCenter.y)).toBeCloseTo(14);
    expect(segment.end).toEqual({ x: 390, y: 48 });
  });
});
