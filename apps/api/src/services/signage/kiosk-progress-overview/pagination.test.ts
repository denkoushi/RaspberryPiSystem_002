import { describe, expect, it } from 'vitest';

import { progressOverviewPageCount, sliceProgressOverviewItems } from './pagination.js';

describe('kiosk-progress-overview pagination', () => {
  it('computes page count', () => {
    expect(progressOverviewPageCount(0, 5)).toBe(0);
    expect(progressOverviewPageCount(1, 5)).toBe(1);
    expect(progressOverviewPageCount(5, 5)).toBe(1);
    expect(progressOverviewPageCount(6, 5)).toBe(2);
    expect(progressOverviewPageCount(10, 5)).toBe(2);
    expect(progressOverviewPageCount(11, 5)).toBe(3);
  });

  it('slices pages', () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    expect(sliceProgressOverviewItems(items, 0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(sliceProgressOverviewItems(items, 1, 5)).toEqual([6, 7]);
    expect(sliceProgressOverviewItems(items, 2, 5)).toEqual([]);
  });
});
