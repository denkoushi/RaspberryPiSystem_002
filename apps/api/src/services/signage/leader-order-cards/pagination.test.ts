import { describe, expect, it } from 'vitest';

import {
  leaderOrderCardsPageCount,
  sanitizeLeaderOrderCardsPerPage,
  sliceLeaderOrderCardPage,
} from './pagination.js';

describe('leader-order-cards pagination', () => {
  it('sanitizeLeaderOrderCardsPerPage clamps to 1..8', () => {
    expect(sanitizeLeaderOrderCardsPerPage(Number.NaN)).toBe(8);
    expect(sanitizeLeaderOrderCardsPerPage(0)).toBe(1);
    expect(sanitizeLeaderOrderCardsPerPage(99)).toBe(8);
    expect(sanitizeLeaderOrderCardsPerPage(2)).toBe(2);
  });

  it('leaderOrderCardsPageCount and slice', () => {
    expect(leaderOrderCardsPageCount(9, 8)).toBe(2);
    const cards = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(sliceLeaderOrderCardPage(cards, 0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sliceLeaderOrderCardPage(cards, 1, 8)).toEqual([9]);
  });
});
