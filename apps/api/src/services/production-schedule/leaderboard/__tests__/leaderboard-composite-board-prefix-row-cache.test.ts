import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearLeaderboardBoardPrefixRowCacheForTests,
  putLeaderboardBoardPrefixRowsInCache,
  resolveLeaderboardBoardPrefixRowsFromCache
} from '../leaderboard-composite-board-prefix-row-cache.js';

describe('leaderboard-composite-board-prefix-row-cache', () => {
  beforeEach(() => {
    clearLeaderboardBoardPrefixRowCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('snapshot 単位で行をキャッシュし順序付きで取り出す', () => {
    const rows = [
      { id: 'a', rowData: {} },
      { id: 'b', rowData: {} }
    ] as never[];
    putLeaderboardBoardPrefixRowsInCache('snap-1', rows);
    const { cachedRows, missingIds } = resolveLeaderboardBoardPrefixRowsFromCache('snap-1', ['a', 'b']);
    expect(missingIds).toEqual([]);
    expect(cachedRows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('キャッシュに無い id は missing に列挙する', () => {
    putLeaderboardBoardPrefixRowsInCache('snap-1', [{ id: 'a', rowData: {} } as never]);
    const { cachedRows, missingIds } = resolveLeaderboardBoardPrefixRowsFromCache('snap-1', ['a', 'c']);
    expect(cachedRows.map((r) => r.id)).toEqual(['a']);
    expect(missingIds).toEqual(['c']);
  });

  it('snapshot TTL を過ぎたキャッシュは返さない', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T04:00:00.000Z'));
    putLeaderboardBoardPrefixRowsInCache('snap-1', [{ id: 'a', rowData: {} } as never]);

    vi.setSystemTime(new Date('2026-05-19T04:06:00.000Z'));
    const { cachedRows, missingIds } = resolveLeaderboardBoardPrefixRowsFromCache('snap-1', ['a']);

    expect(cachedRows).toEqual([]);
    expect(missingIds).toEqual(['a']);
  });
});
