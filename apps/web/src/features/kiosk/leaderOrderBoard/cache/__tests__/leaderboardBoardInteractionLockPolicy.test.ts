import { describe, expect, it } from 'vitest';

import {
  isLeaderboardBoardBackgroundRevalidating,
  isLeaderboardBoardInteractionLocked
} from '../leaderboardBoardInteractionLockPolicy';

describe('leaderboardBoardInteractionLockPolicy', () => {
  it('背景再検証中はロック', () => {
    expect(
      isLeaderboardBoardInteractionLocked({
        isBackgroundRevalidating: true,
        isMutationInFlight: false
      })
    ).toBe(true);
  });

  it('mutation 実行中はロック', () => {
    expect(
      isLeaderboardBoardInteractionLocked({
        isBackgroundRevalidating: false,
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
});
