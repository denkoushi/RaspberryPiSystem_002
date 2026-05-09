import { describe, expect, it } from 'vitest';

import { computeLeaderboardShellFillerBudget } from '../leaderboard-shell-filler-budget.js';

describe('computeLeaderboardShellFillerBudget', () => {
  it('takeCount 20: tighter caps than legacy-style filler binge', () => {
    const { maxFillerTotal, batchTakeSoftCap } = computeLeaderboardShellFillerBudget({
      takeCount: 20,
      excludeRowIdCount: 0
    });
    expect(batchTakeSoftCap).toBeLessThanOrEqual(320);
    expect(batchTakeSoftCap).toBeGreaterThanOrEqual(64);
    expect(batchTakeSoftCap).toBeLessThanOrEqual(200);

    expect(maxFillerTotal).toBeLessThanOrEqual(12_000);
    expect(maxFillerTotal).toBeLessThan(20 * 48 + 800);
  });

  it('large page keeps reasonably-sized filler batches', () => {
    const { batchTakeSoftCap } = computeLeaderboardShellFillerBudget({
      takeCount: 160,
      excludeRowIdCount: 0
    });
    expect(batchTakeSoftCap).toBe(320);
  });
});
