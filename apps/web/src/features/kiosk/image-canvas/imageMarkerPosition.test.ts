import { describe, expect, it } from 'vitest';

import {
  clampImageMarkerRatio,
  IMAGE_MARKER_NUDGE_STEP_RATIO,
  imageMarkerPositionPatch,
  nudgeImageMarkerPosition
} from './imageMarkerPosition';

describe('imageMarkerPosition', () => {
  it('moves by the fixed ratio in all four directions without mutating the source', () => {
    const source = { id: 'marker-1', xRatio: 0.5, yRatio: 0.5 };
    const step = IMAGE_MARKER_NUDGE_STEP_RATIO;

    expect(nudgeImageMarkerPosition(source, 'up').yRatio).toBeCloseTo(0.5 - step);
    expect(nudgeImageMarkerPosition(source, 'down').yRatio).toBeCloseTo(0.5 + step);
    expect(nudgeImageMarkerPosition(source, 'left').xRatio).toBeCloseTo(0.5 - step);
    expect(nudgeImageMarkerPosition(source, 'right').xRatio).toBeCloseTo(0.5 + step);
    expect(source).toEqual({ id: 'marker-1', xRatio: 0.5, yRatio: 0.5 });
  });

  it('preserves additional domain fields and returns only coordinates in a patch', () => {
    const source = { id: 'marker-1', markerNo: 7, pageIndex: 2, xRatio: 0.25, yRatio: 0.75 };

    expect(nudgeImageMarkerPosition(source, 'right')).toEqual({
      ...source,
      xRatio: 0.25 + IMAGE_MARKER_NUDGE_STEP_RATIO
    });
    expect(imageMarkerPositionPatch(source, 'left')).toEqual({
      xRatio: 0.25 - IMAGE_MARKER_NUDGE_STEP_RATIO,
      yRatio: 0.75
    });
  });

  it('clamps boundaries and maps non-finite values to zero', () => {
    expect(nudgeImageMarkerPosition({ xRatio: 0, yRatio: 1 }, 'left')).toEqual({
      xRatio: 0,
      yRatio: 1
    });
    expect(nudgeImageMarkerPosition({ xRatio: 0, yRatio: 1 }, 'down')).toEqual({
      xRatio: 0,
      yRatio: 1
    });
    expect(clampImageMarkerRatio(Number.NaN)).toBe(0);
    expect(clampImageMarkerRatio(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampImageMarkerRatio(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});
