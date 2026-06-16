import { describe, expect, it } from 'vitest';

import {
  isLeaderboardBoardBackgroundRevalidating,
  isLeaderboardBoardDataSyncing,
  isLeaderboardBoardInteractionLocked,
  isLeaderboardDecorationSyncing
} from '../leaderboardBoardInteractionLockPolicy';

describe('leaderboardBoardInteractionLockPolicy', () => {
  it('背景再検証中でもロックしない', () => {
    expect(
      isLeaderboardBoardInteractionLocked({
        isMutationInFlight: false
      })
    ).toBe(false);
  });

  it('mutation 実行中はロック', () => {
    expect(
      isLeaderboardBoardInteractionLocked({
        isMutationInFlight: true
      })
    ).toBe(true);
  });

  it('append 中は背景再検証', () => {
    expect(
      isLeaderboardBoardBackgroundRevalidating({
        scheduleEnabled: true,
        networkBoardComplete: true,
        networkInitialLoading: false,
        networkIsFetching: false,
        isAppending: true,
        isDecorationsFetching: false
      })
    ).toBe(true);
  });

  it('完走かつ idle なら背景再検証ではない', () => {
    expect(
      isLeaderboardBoardBackgroundRevalidating({
        scheduleEnabled: true,
        networkBoardComplete: true,
        networkInitialLoading: false,
        networkIsFetching: false,
        isAppending: false,
        isDecorationsFetching: false
      })
    ).toBe(false);
  });

  it('board 再取得中は背景再検証', () => {
    expect(
      isLeaderboardBoardBackgroundRevalidating({
        scheduleEnabled: true,
        networkBoardComplete: true,
        networkInitialLoading: false,
        networkIsFetching: true,
        isAppending: false,
        isDecorationsFetching: false
      })
    ).toBe(true);
  });

  it('装飾取得中は背景再検証だが board data syncing ではない', () => {
    expect(
      isLeaderboardBoardDataSyncing({
        scheduleEnabled: true,
        networkBoardComplete: true,
        networkInitialLoading: false,
        networkIsFetching: false,
        isAppending: false
      })
    ).toBe(false);
    expect(
      isLeaderboardDecorationSyncing({
        scheduleEnabled: true,
        isDecorationsFetching: true
      })
    ).toBe(true);
    expect(
      isLeaderboardBoardBackgroundRevalidating({
        scheduleEnabled: true,
        networkBoardComplete: true,
        networkInitialLoading: false,
        networkIsFetching: false,
        isAppending: false,
        isDecorationsFetching: true
      })
    ).toBe(true);
  });

  it('ページング未完なら背景再検証', () => {
    expect(
      isLeaderboardBoardBackgroundRevalidating({
        scheduleEnabled: true,
        networkBoardComplete: false,
        networkInitialLoading: false,
        networkIsFetching: false,
        isAppending: false,
        isDecorationsFetching: false
      })
    ).toBe(true);
  });
});
