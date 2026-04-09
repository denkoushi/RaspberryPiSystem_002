import { describe, expect, it } from 'vitest';

import { computeNearVisibleIndices, pickBestVisibleRowIndex } from './kioskDocumentViewerVisibility';

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

describe('pickBestVisibleRowIndex', () => {
  it('returns 0 when totalRows is 0', () => {
    expect(pickBestVisibleRowIndex(new Map(), 3, 0)).toBe(0);
  });

  it('returns clamped fallback when there are no visible rows', () => {
    expect(pickBestVisibleRowIndex(new Map(), 3, 10)).toBe(3);
  });

  it('picks the highest visible ratio from all tracked rows', () => {
    const ratios = new Map([
      [2, 0.25],
      [3, 0.8],
      [4, 0.5],
    ]);
    expect(pickBestVisibleRowIndex(ratios, 2, 10)).toBe(3);
  });

  it('keeps the fallback row when ratios are tied', () => {
    const ratios = new Map([
      [3, 0.5],
      [4, 0.5],
    ]);
    expect(pickBestVisibleRowIndex(ratios, 4, 10)).toBe(4);
  });

  it('ignores indices outside row range (stale map entries)', () => {
    const ratios = new Map([
      [99, 0.99],
      [2, 0.3],
    ]);
    expect(pickBestVisibleRowIndex(ratios, 0, 5)).toBe(2);
  });

  it('clamps fallback to valid range', () => {
    expect(pickBestVisibleRowIndex(new Map(), 99, 5)).toBe(4);
  });
});
