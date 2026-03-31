import { describe, expect, it } from 'vitest';

import {
  progressOverviewPageCount,
  sanitizeSeibanPerPage,
  sliceProgressOverviewItems,
} from './pagination.js';

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

  it('sanitizes seibanPerPage into 1..8', () => {
    expect(sanitizeSeibanPerPage(0)).toBe(1);
    expect(sanitizeSeibanPerPage(1)).toBe(1);
    expect(sanitizeSeibanPerPage(4.8)).toBe(4);
    expect(sanitizeSeibanPerPage(8)).toBe(8);
    expect(sanitizeSeibanPerPage(9)).toBe(8);
  });
});
