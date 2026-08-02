import { describe, expect, it } from 'vitest';

import { computeNormalizedBottomRightAnchor } from './captureGeometry.js';

describe('kiosk SOP capture geometry', () => {
  it('normalizes the target bottom-right corner', () => {
    expect(computeNormalizedBottomRightAnchor(
      { left: 320, top: 160, width: 160, height: 80 },
      { width: 1280, height: 800 }
    )).toEqual({ x: 0.375, y: 0.3 });
  });

  it('accepts a target ending exactly at the viewport boundary', () => {
    expect(computeNormalizedBottomRightAnchor(
      { left: 1200, top: 760, width: 80, height: 40 },
      { width: 1280, height: 800 }
    )).toEqual({ x: 1, y: 1 });
  });

  it('rejects invalid dimensions and out-of-viewport targets', () => {
    expect(() => computeNormalizedBottomRightAnchor(
      { left: 0, top: 0, width: 0, height: 10 },
      { width: 1280, height: 800 }
    )).toThrow(/target width/);
    expect(() => computeNormalizedBottomRightAnchor(
      { left: 1270, top: 0, width: 20, height: 10 },
      { width: 1280, height: 800 }
    )).toThrow(/inside the capture viewport/);
  });
});
