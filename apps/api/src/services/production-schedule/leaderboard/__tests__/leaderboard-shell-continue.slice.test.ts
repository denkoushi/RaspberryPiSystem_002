import { describe, expect, it } from 'vitest';

import {
  sliceLeaderboardSnapshotIdsByCursor,
  sliceLeaderboardSnapshotIdsByExcludePrefix
} from '../leaderboard-shell-continue.slice.js';

describe('leaderboard-shell-continue.slice', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'] as const;

  it('sliceLeaderboardSnapshotIdsByCursor advances nextCursor and hasMore', () => {
    const r1 = sliceLeaderboardSnapshotIdsByCursor(ids, 0, 2);
    expect(r1).toEqual({
      kind: 'ok',
      sliceIds: ['a', 'b'],
      nextCursor: 2,
      hasMore: true
    });
    const r2 = sliceLeaderboardSnapshotIdsByCursor(ids, 2, 10);
    expect(r2).toEqual({
      kind: 'ok',
      sliceIds: ['c', 'd', 'e'],
      nextCursor: 5,
      hasMore: false
    });
  });

  it('sliceLeaderboardSnapshotIdsByCursor rejects cursor beyond length', () => {
    expect(sliceLeaderboardSnapshotIdsByCursor(ids, 6, 2)).toEqual({ kind: 'cursor_overflow' });
  });

  it('sliceLeaderboardSnapshotIdsByExcludePrefix matches legacy prefix semantics', () => {
    expect(sliceLeaderboardSnapshotIdsByExcludePrefix(ids, ['a', 'b'], 2)).toEqual({
      kind: 'ok',
      sliceIds: ['c', 'd'],
      nextCursor: 4,
      hasMore: true
    });
    expect(sliceLeaderboardSnapshotIdsByExcludePrefix(ids, ['x'], 2)).toEqual({ kind: 'expired' });
  });
});
