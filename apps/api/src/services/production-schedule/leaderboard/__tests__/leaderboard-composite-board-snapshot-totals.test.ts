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

  it('seeds and resolves total by snapshotId', () => {
    seedLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', 142);
    expect(resolveLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(142);
  });

  it('returns undefined for unknown or empty snapshotId', () => {
    expect(resolveLeaderboardBoardSnapshotResourceTotal(undefined)).toBeUndefined();
    expect(resolveLeaderboardBoardSnapshotResourceTotal('')).toBeUndefined();
    expect(resolveLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-ffffffffffff')).toBeUndefined();
  });

  it('expires entries after TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-19T12:00:00.000Z'));
    process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS = '60000';

    seedLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-111111111111', 10);
    vi.advanceTimersByTime(61_000);
    expect(resolveLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-111111111111')).toBeUndefined();

    delete process.env.LEADERBOARD_SHELL_SNAPSHOT_TTL_MS;
  });

  it('normalizes negative totals to zero', () => {
    seedLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-222222222222', -3);
    expect(resolveLeaderboardBoardSnapshotResourceTotal('aaaaaaaa-bbbb-cccc-dddd-222222222222')).toBe(0);
  });
});
