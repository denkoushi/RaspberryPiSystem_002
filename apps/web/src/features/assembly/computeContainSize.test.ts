import { describe, expect, it } from 'vitest';

import { computeContainSize } from './computeContainSize';

describe('computeContainSize', () => {
  it('fits a portrait page into a wide parent by height', () => {
    // A4-ish 210x297 into 800x600 → limited by height
    expect(computeContainSize(800, 600, 210, 297)).toEqual({
      width: Math.floor(210 * (600 / 297)),
      height: 600
    });
  });

  it('fits a landscape page into a tall parent by width', () => {
    expect(computeContainSize(400, 800, 800, 400)).toEqual({
      width: 400,
      height: 200
    });
  });

  it('returns zeros for invalid inputs', () => {
    expect(computeContainSize(0, 100, 10, 10)).toEqual({ width: 0, height: 0 });
    expect(computeContainSize(100, 100, 0, 10)).toEqual({ width: 0, height: 0 });
  });
});
