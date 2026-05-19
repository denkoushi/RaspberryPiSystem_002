import { describe, expect, it, vi } from 'vitest';

import {
  canApplyLeaderboardSeibanClientFilter,
  canDisplayLeaderboardSeibanClientFilter
} from '../leaderboardBoardSeibanClientFilterPolicy';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function completeBoard(): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: 1,
    rows: [{ id: 'r1' }],
    resources: [{ resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }]
  } as ProductionScheduleLeaderboardBoardResponse;
}

describe('canApplyLeaderboardSeibanClientFilter', () => {
  it('製番あり・完走 board・フラグ ON なら true', () => {
    vi.stubEnv('VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER', 'true');
    expect(
      canApplyLeaderboardSeibanClientFilter({
        seibanOrFilters: ['AA111111'],
        baseBoard: completeBoard()
      })
    ).toBe(true);
    vi.unstubAllEnvs();
  });

  it('製番なしなら false', () => {
    vi.stubEnv('VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER', 'true');
    expect(
      canApplyLeaderboardSeibanClientFilter({
        seibanOrFilters: [],
        baseBoard: completeBoard()
      })
    ).toBe(false);
    vi.unstubAllEnvs();
  });

  it('未完走 board なら false', () => {
    vi.stubEnv('VITE_KIOSK_LEADERBOARD_SEIBAN_OR_CLIENT_FILTER', 'true');
    const incomplete = {
      page: 1,
      pageSize: 80,
      total: 10,
      rows: [{ id: 'r1' }],
      resources: [{ resourceCd: 'R1', hasMore: true, total: 10, pageSize: 80 }]
    } as ProductionScheduleLeaderboardBoardResponse;
    expect(
      canApplyLeaderboardSeibanClientFilter({
        seibanOrFilters: ['AA111111'],
        baseBoard: incomplete
      })
    ).toBe(false);
    expect(
      canDisplayLeaderboardSeibanClientFilter({
        seibanOrFilters: ['AA111111'],
        baseBoard: incomplete
      })
    ).toBe(true);
    vi.unstubAllEnvs();
  });
});
