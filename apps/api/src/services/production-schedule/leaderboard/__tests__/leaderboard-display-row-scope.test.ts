import { describe, expect, it } from 'vitest';

import {
  LEADERBOARD_DISPLAY_ROW_SCOPE_ABS_MAX,
  LEADERBOARD_HYDRATE_SQL_BATCH_MAX,
  chunkLeaderboardRowIdsForHydrate,
  normalizeLeaderboardDisplayRowIdScope
} from '../leaderboard-display-row-scope.js';

describe('normalizeLeaderboardDisplayRowIdScope', () => {
  it('trims, de-dupes in first-seen order, and skips empty tokens', () => {
    expect(normalizeLeaderboardDisplayRowIdScope(['  a ', ' b', ' a ', '', '  b '])).toEqual(['a', 'b']);
  });

  it('stops at LEADERBOARD_DISPLAY_ROW_SCOPE_ABS_MAX', () => {
    const many = Array.from({ length: LEADERBOARD_DISPLAY_ROW_SCOPE_ABS_MAX + 50 }, (_, i) => `id-${i}`);
    const out = normalizeLeaderboardDisplayRowIdScope(many);
    expect(out).toHaveLength(LEADERBOARD_DISPLAY_ROW_SCOPE_ABS_MAX);
    expect(out[0]).toBe('id-0');
    expect(out.at(-1)).toBe(`id-${LEADERBOARD_DISPLAY_ROW_SCOPE_ABS_MAX - 1}`);
  });
});

describe('chunkLeaderboardRowIdsForHydrate', () => {
  it('splits into fixed-size chunks (default LEADERBOARD_HYDRATE_SQL_BATCH_MAX)', () => {
    const ids = Array.from({ length: LEADERBOARD_HYDRATE_SQL_BATCH_MAX + 3 }, (_, i) => `r${i}`);
    const chunks = chunkLeaderboardRowIdsForHydrate(ids);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(LEADERBOARD_HYDRATE_SQL_BATCH_MAX);
    expect(chunks[1]).toEqual(['r900', 'r901', 'r902']);
  });

  it('honors explicit chunk size', () => {
    expect(chunkLeaderboardRowIdsForHydrate(['a', 'b', 'c', 'd'], 3)).toEqual([['a', 'b', 'c'], ['d']]);
  });
});
