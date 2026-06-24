import { describe, expect, it } from 'vitest';

import { buildLeaderboardBoardContinuePayload } from '../buildLeaderboardBoardContinuePayload';
import { LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE } from '../constants';

import type {
  KioskProductionScheduleLeaderboardBoardQueryParams,
  ProductionScheduleLeaderboardBoardResponse
} from '../../../../api/client';

const base: KioskProductionScheduleLeaderboardBoardQueryParams = {
  boardResourceCds: 'R1',
  allowResourceOnly: true,
  includeLabor: false,
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
    expect(payload.pageSize).toBe(LEADER_ORDER_BOARD_CONTINUE_CHUNK_SIZE);
    expect(payload.includeDecorations).toBe(false);
    expect(payload.includeLabor).toBe(false);
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

  it('query 由来の文字列 allowResourceOnly でも POST body は boolean になる', () => {
    const board: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 80,
      total: 1,
      rows: [],
      resources: [{ resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }]
    };
    const payload = buildLeaderboardBoardContinuePayload(
      {
        ...base,
        allowResourceOnly: 'true' as unknown as boolean
      },
      board
    );
    expect(payload.allowResourceOnly).toBe(true);
    expect(typeof payload.allowResourceOnly).toBe('boolean');
    expect(payload.includeDecorations).toBe(false);
    expect(typeof payload.includeDecorations).toBe('boolean');
  });

  it('不明な文字列 allowResourceOnly は POST body に載せない', () => {
    const board: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 80,
      total: 1,
      rows: [],
      resources: [{ resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }]
    };
    const payload = buildLeaderboardBoardContinuePayload(
      {
        ...base,
        allowResourceOnly: 'yes' as unknown as boolean
      },
      board
    );
    expect('allowResourceOnly' in payload).toBe(false);
  });

  it('初回 shell 専用の deferTotals は POST body に載せない', () => {
    const board: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 80,
      total: 1,
      rows: [],
      resources: [{ resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }]
    };
    const payload = buildLeaderboardBoardContinuePayload(
      {
        ...base,
        deferTotals: true
      },
      board
    );
    expect('deferTotals' in payload).toBe(false);
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
