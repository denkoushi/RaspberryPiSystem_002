import { describe, expect, it } from 'vitest';

import { estimateLateStarLabelHeight } from './planningBoardLateStars';

const groups = (count: number, dates = ['2026-11-05']) => Array.from({ length: count }, (_, i) => ({ fseiban: String(i), dates }));

describe('estimateLateStarLabelHeight', () => {
  it('counts the label lines without stars', () => {
    expect(estimateLateStarLabelHeight([], 304, true)).toBe(32);
  });

  it('fits three short date groups on one button line', () => {
    expect(estimateLateStarLabelHeight(groups(3), 304, true)).toBe(60);
  });

  it('wraps buttons and accounts for gaps between lines', () => {
    expect(estimateLateStarLabelHeight(groups(8), 304, true)).toBe(92);
    expect(estimateLateStarLabelHeight(groups(3), 96, true)).toBe(124);
  });

  it('uses smaller text and padding for static dates', () => {
    expect(estimateLateStarLabelHeight(groups(8), 304, false)).toBe(68);
    expect(estimateLateStarLabelHeight(groups(3), 100, false)).toBe(68);
  });

  it('uses all dates in a group when estimating its width', () => {
    expect(estimateLateStarLabelHeight(groups(3, ['2026-11-05', '2026-11-06', '2026-11-07']), 304, true)).toBe(92);
  });

  it('places an oversized group on its own line', () => {
    expect(estimateLateStarLabelHeight(groups(2, Array(12).fill('2026-11-05')), 304, true)).toBe(92);
  });
});
