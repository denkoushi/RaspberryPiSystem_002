import { describe, expect, it } from 'vitest';
import { gapFromPhotoBottomToDateBaseline, maxWidthUnitsForFont } from './loan-card-metrics.js';

describe('loan-card-metrics', () => {
  it('maxWidthUnitsForFont scales with column width and font size', () => {
    expect(maxWidthUnitsForFont(88, 16)).toBe(6);
    expect(maxWidthUnitsForFont(196, 14)).toBe(15);
    expect(maxWidthUnitsForFont(0, 14)).toBe(4);
  });

  it('gapFromPhotoBottomToDateBaseline clears typical ascenders', () => {
    expect(gapFromPhotoBottomToDateBaseline(13, 1)).toBeGreaterThanOrEqual(16);
  });
});
