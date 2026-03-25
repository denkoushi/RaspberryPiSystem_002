import { describe, expect, it } from 'vitest';

import { computeNearVisibleIndices } from './kioskDocumentViewerVisibility';

describe('computeNearVisibleIndices', () => {
  it('returns empty set when totalRows is 0', () => {
    expect(computeNearVisibleIndices(0, 0, 2).size).toBe(0);
  });

  it('returns empty set when radius is negative', () => {
    expect(computeNearVisibleIndices(0, 5, -1).size).toBe(0);
  });

  it('clamps activeIndex into range', () => {
    const s = computeNearVisibleIndices(99, 3, 1);
    // last row index 2, radius 1 → rows 1..2
    expect([...s].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('includes center and radius on each side', () => {
    const s = computeNearVisibleIndices(3, 10, 2);
    expect([...s].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('does not go below 0 at start', () => {
    const s = computeNearVisibleIndices(0, 10, 2);
    expect([...s].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it('does not exceed last index at end', () => {
    const s = computeNearVisibleIndices(9, 10, 2);
    expect([...s].sort((a, b) => a - b)).toEqual([7, 8, 9]);
  });
});
