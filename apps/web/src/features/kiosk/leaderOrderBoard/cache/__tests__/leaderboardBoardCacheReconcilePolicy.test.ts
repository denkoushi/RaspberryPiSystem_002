import { describe, expect, it } from 'vitest';

import { reconcileLeaderboardBoardCacheWithServer } from '../leaderboardBoardCacheReconcilePolicy';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function board(partial: Partial<ProductionScheduleLeaderboardBoardResponse>): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: 0,
    rows: [],
    resources: [],
    ...partial
  };
}

describe('reconcileLeaderboardBoardCacheWithServer', () => {
  const aligned = board({
    total: 2,
    rows: [{ id: 'a' }, { id: 'b' }] as ProductionScheduleLeaderboardBoardResponse['rows'],
    resources: [{ resourceCd: '1', hasMore: false, total: 2, pageSize: 80 }]
  });

  it('同一 id 列・total なら aligned', () => {
    expect(reconcileLeaderboardBoardCacheWithServer(aligned, { ...aligned })).toEqual({
      kind: 'aligned'
    });
  });

  it('total 不一致は serverWins', () => {
    const server = board({ ...aligned, total: 3 });
    expect(reconcileLeaderboardBoardCacheWithServer(aligned, server).kind).toBe('serverWins');
  });

  it('id 列不一致は serverWins', () => {
    const server = board({
      ...aligned,
      rows: [{ id: 'b' }, { id: 'a' }] as ProductionScheduleLeaderboardBoardResponse['rows']
    });
    expect(reconcileLeaderboardBoardCacheWithServer(aligned, server).kind).toBe('serverWins');
  });

  it('resource total 不一致は serverWins', () => {
    const server = board({
      ...aligned,
      resources: [{ resourceCd: '1', hasMore: false, total: 99, pageSize: 80 }]
    });
    expect(reconcileLeaderboardBoardCacheWithServer(aligned, server).kind).toBe('serverWins');
  });

  it('通常行が一致しても工程変更残骸メタが違えば serverWins', () => {
    const cached = board({
      ...aligned,
      processChangeResidualTotal: 1,
      processChangeResidualRows: [{ id: 'res-old' }] as ProductionScheduleLeaderboardBoardResponse['rows']
    });
    const server = board({
      ...aligned,
      processChangeResidualTotal: 0,
      processChangeResidualRows: []
    });
    expect(reconcileLeaderboardBoardCacheWithServer(cached, server)).toEqual({
      kind: 'serverWins',
      reason: 'board content mismatch'
    });
  });
});
