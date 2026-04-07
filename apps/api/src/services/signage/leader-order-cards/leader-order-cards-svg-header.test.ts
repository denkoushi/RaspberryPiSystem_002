import { describe, expect, it } from 'vitest';

import { computeLeaderOrderHeaderTruncation } from './leader-order-cards-svg-header.js';

describe('leader-order-cards-svg-header', () => {
  it('computeLeaderOrderHeaderTruncation keeps title and jp within finite budgets', () => {
    const narrow = computeLeaderOrderHeaderTruncation(120, 28, 20);
    expect(narrow.titleMaxChars).toBeGreaterThanOrEqual(4);
    expect(narrow.jpMaxChars).toBeGreaterThanOrEqual(8);

    const wide = computeLeaderOrderHeaderTruncation(800, 28, 20);
    expect(wide.titleMaxChars).toBeLessThanOrEqual(14);
    expect(wide.jpMaxChars).toBeLessThanOrEqual(36);
  });
});
