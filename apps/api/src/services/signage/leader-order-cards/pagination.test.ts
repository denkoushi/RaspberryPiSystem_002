import { describe, expect, it } from 'vitest';

import {
  leaderOrderCardsPageCount,
  sanitizeLeaderOrderCardsPerPage,
  sliceLeaderOrderCardPage,
} from './pagination.js';

describe('leader-order-cards pagination', () => {
  it('sanitizeLeaderOrderCardsPerPage clamps to 1..4', () => {
    expect(sanitizeLeaderOrderCardsPerPage(Number.NaN)).toBe(4);
    expect(sanitizeLeaderOrderCardsPerPage(0)).toBe(1);
    expect(sanitizeLeaderOrderCardsPerPage(99)).toBe(4);
    expect(sanitizeLeaderOrderCardsPerPage(2)).toBe(2);
  });

  it('leaderOrderCardsPageCount and slice', () => {
    expect(leaderOrderCardsPageCount(5, 4)).toBe(2);
    const cards = [1, 2, 3, 4, 5];
    expect(sliceLeaderOrderCardPage(cards, 0, 4)).toEqual([1, 2, 3, 4]);
    expect(sliceLeaderOrderCardPage(cards, 1, 4)).toEqual([5]);
  });
});
