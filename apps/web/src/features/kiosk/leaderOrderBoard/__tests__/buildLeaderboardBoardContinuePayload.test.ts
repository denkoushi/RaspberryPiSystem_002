import { describe, expect, it } from 'vitest';

import { buildLeaderboardBoardContinuePayload } from '../buildLeaderboardBoardContinuePayload';

import type {
  KioskProductionScheduleLeaderboardBoardQueryParams,
  ProductionScheduleLeaderboardBoardResponse
} from '../../../../api/client';

const base: KioskProductionScheduleLeaderboardBoardQueryParams = {
  boardResourceCds: 'R1',
  allowResourceOnly: true,
  pageSize: 10
};

describe('buildLeaderboardBoardContinuePayload', () => {
  it('hasMore + snapshotId で nextCursor が欠けていても cursor:0 を載せる（Zod 契約の保険）', () => {
    const board: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 80,
      total: 3,
      rows: [],
      resources: [
        {
          resourceCd: 'R1',
          snapshotId: '550e8400-e29b-41d4-a716-446655440000',
          hasMore: true,
          total: 3,
          pageSize: 80
        }
      ]
    };
    const payload = buildLeaderboardBoardContinuePayload(base, board);
    expect(payload.pageSize).toBe(40);
    expect(payload.resourceSlices[0]!.cursor).toBe(0);
    expect(payload.resourceSlices[0]!.hasMore).toBe(true);
  });

  it('hasMore が false のスライスでは cursor キーを載せない', () => {
    const board: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 80,
      total: 1,
      rows: [],
      resources: [
        {
          resourceCd: 'R1',
          hasMore: false,
          total: 1,
          pageSize: 80
        }
      ]
    };
    const payload = buildLeaderboardBoardContinuePayload(base, board);
    expect('cursor' in payload.resourceSlices[0]!).toBe(false);
  });

  it('有限の nextCursor は切り捨てて正の cursor にする', () => {
    const board: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 80,
      total: 5,
      rows: [],
      resources: [
        {
          resourceCd: 'R1',
          snapshotId: '550e8400-e29b-41d4-a716-446655440001',
          nextCursor: 9.7,
          hasMore: true,
          total: 5,
          pageSize: 80
        }
      ]
    };
    const payload = buildLeaderboardBoardContinuePayload(base, board);
    expect(payload.resourceSlices[0]!.cursor).toBe(9);
  });
});
