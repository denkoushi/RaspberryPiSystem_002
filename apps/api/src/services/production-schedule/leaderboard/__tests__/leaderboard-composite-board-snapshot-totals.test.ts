import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearLeaderboardBoardSnapshotResourceTotalsForTests,
  resolveLeaderboardBoardSnapshotResourceTotal,
  seedLeaderboardBoardSnapshotResourceTotal
} from '../leaderboard-composite-board-snapshot-totals.js';

describe('leaderboard-composite-board-snapshot-totals', () => {
  afterEach(() => {
    clearLeaderboardBoardSnapshotResourceTotalsForTests();
    vi.useRealTimers();
  });

  async function withFakeSystemTime<T>(now: Date, run: () => T | Promise<T>): Promise<T> {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      return await run();
    } finally {
      vi.useRealTimers();
    }
  }

  it('seeds and resolves total by snapshotId', () => {
    seedLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 142);
    expect(resolveLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(142);
  });

  it('returns undefined for unknown or empty snapshotId', () => {
    expect(resolveLeaderboardBoardSnapshotResourceTotal(undefined)).toBeUndefined();
    expect(resolveLeaderboardBoardSnapshotResourceTotal('')).toBeUndefined();
    expect(resolveLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-ffffffffffff')).toBeUndefined();
  });

  it('expires entries after TTL', async () => {
    await withFakeSystemTime(new Date('2026-05-19T12:00:00.000Z'), () => {
      const previousTtl = process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS;
      process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS = '60000';
      try {
        seedLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-111111111111', 10);
        vi.setSystemTime(new Date('2026-05-19T12:01:01.000Z'));
        expect(resolveLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-111111111111')).toBeUndefined();
      } finally {
        if (previousTtl === undefined) {
          delete process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS;
        } else {
          process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS = previousTtl;
        }
      }
    });
  });

  it('normalizes negative totals to zero', () => {
    seedLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-222222222222', -3);
    expect(resolveLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-222222222222')).toBe(0);
  });
});
