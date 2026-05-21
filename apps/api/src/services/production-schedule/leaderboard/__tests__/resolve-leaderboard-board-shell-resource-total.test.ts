import { describe, expect, it } from 'vitest';

import { resolveLeaderboardBoardShellResourceTotalFromShell } from '../resolve-leaderboard-board-shell-resource-total.js';

describe('resolveLeaderboardBoardShellResourceTotalFromShell', () => {
  it('returns rows.length when merge completed (hasMore=false)', () => {
    expect(
      resolveLeaderboardBoardShellResourceTotalFromShell({
        rows: [{ id: 'a' }, { id: 'b' }],
        hasMore: false
      })
    ).toBe(2);
  });

  it('returns undefined when hasMore=true (COUNT required)', () => {
    expect(
      resolveLeaderboardBoardShellResourceTotalFromShell({
        rows: Array.from({ length: 80 }, (_, i) => ({ id: `id-${i}` })),
        hasMore: true
      })
    ).toBeUndefined();
  });
});
