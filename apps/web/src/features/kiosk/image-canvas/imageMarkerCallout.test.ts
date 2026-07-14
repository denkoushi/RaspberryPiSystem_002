import { describe, expect, it } from 'vitest';

import {
  clearImageMarkerCalloutTip,
  imageMarkerHasCalloutTip,
  setImageMarkerCalloutTip
} from './imageMarkerCallout';

describe('image marker callout tip', () => {
  it('requires a finite paired ratio and clamps newly placed tips', () => {
    expect(imageMarkerHasCalloutTip({ calloutTipXRatio: 0.2, calloutTipYRatio: 0.8 })).toBe(true);
    expect(imageMarkerHasCalloutTip({ calloutTipXRatio: 0.2, calloutTipYRatio: null })).toBe(false);
    expect(imageMarkerHasCalloutTip({ calloutTipXRatio: Number.NaN, calloutTipYRatio: 0.8 })).toBe(false);
    expect(setImageMarkerCalloutTip(-1, 2)).toEqual({ calloutTipXRatio: 0, calloutTipYRatio: 1 });
    expect(clearImageMarkerCalloutTip()).toEqual({ calloutTipXRatio: null, calloutTipYRatio: null });
  });
});
