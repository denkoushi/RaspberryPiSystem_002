import { describe, expect, it } from 'vitest';

import {
  pickLeaderboardAppendOverrideForDisplay,
  resolveScopedLeaderboardAppendOverride
} from '../leaderboardBoardAppendOverrideScopePolicy';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

function board(rows: number): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: rows,
    rows: Array.from({ length: rows }, (_, i) => ({ id: `r${i}` })) as ProductionScheduleLeaderboardBoardResponse['rows'],
    resources: []
  };
}

describe('resolveScopedLeaderboardAppendOverride', () => {
  it('paramsKey が一致すれば override を返す', () => {
    const override = board(3);
    expect(
      resolveScopedLeaderboardAppendOverride({
        paramsKey: 'k1',
        overrideParamsKey: 'k1',
        override
      })
    ).toBe(override);
  });

  it('paramsKey が不一致なら null', () => {
    expect(
      resolveScopedLeaderboardAppendOverride({
        paramsKey: 'k2',
        overrideParamsKey: 'k1',
        override: board(2)
      })
    ).toBeNull();
  });

  it('overrideParamsKey 未確定なら null', () => {
    expect(
      resolveScopedLeaderboardAppendOverride({
        paramsKey: 'k1',
        overrideParamsKey: null,
        override: board(1)
      })
    ).toBeNull();
  });

  it('override が null なら null', () => {
    expect(
      resolveScopedLeaderboardAppendOverride({
        paramsKey: 'k1',
        overrideParamsKey: 'k1',
        override: null
      })
    ).toBeNull();
  });
});

describe('pickLeaderboardAppendOverrideForDisplay', () => {
  it('新しい scoped override が旧表示より短い間は旧表示を維持する', () => {
    const previousComplete = board(2200);
    const freshPartial = board(1183);

    expect(
      pickLeaderboardAppendOverrideForDisplay({
        scopedAppendOverride: freshPartial,
        displayAppendOverride: previousComplete
      })
    ).toBe(previousComplete);
  });

  it('新しい scoped override が追いついたら新しい override を採用する', () => {
    const previousComplete = board(2200);
    const freshComplete = board(2200);

    expect(
      pickLeaderboardAppendOverrideForDisplay({
        scopedAppendOverride: freshComplete,
        displayAppendOverride: previousComplete
      })
    ).toBe(freshComplete);
  });
});
