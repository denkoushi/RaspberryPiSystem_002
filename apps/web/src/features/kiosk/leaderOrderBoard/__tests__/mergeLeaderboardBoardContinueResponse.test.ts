import { describe, expect, it } from 'vitest';

import {
  canMergeLeaderboardContinueDelta,
  mergeLeaderboardBoardContinueResponseWithOptionalDelta,
  partitionLeaderboardCompositeRowsBySlotOrder
} from '../mergeLeaderboardBoardContinueResponse';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../api/client';

function mkRow(id: string, cd: string): ProductionScheduleRow {
  return {
    id,
    occurredAt: '',
    rowData: { FSIGENCD: cd, ProductNo: id },
    resolvedMachineName: null,
    customerName: null
  };
}

describe('mergeLeaderboardBoardContinueResponseWithOptionalDelta', () => {
  it('deltaRows が無ければ応答をそのまま返す', () => {
    const authority = mkRow('a', '10');
    const next: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 20,
      total: 1,
      rows: [authority],
      resources: [{ resourceCd: '10', hasMore: false, total: 1, pageSize: 20 }]
    };
    const prev = mkRow('b', '10');
    const out = mergeLeaderboardBoardContinueResponseWithOptionalDelta([prev], next, ['10']);
    expect(out).toBe(next);
    expect(out.rows[0]).toBe(authority);
  });

  it('スロット整合が取れるときは prev/delta の参照を優先して正本 id 列を維持する', () => {
    const prevA = mkRow('a', '1');
    const prevB = mkRow('b', '1');
    const prevC = mkRow('c', '2');
    const deltaD = mkRow('d', '1');

    const authA = mkRow('a', '1');
    const authB = mkRow('b', '1');
    const authD = mkRow('d', '1');
    const authC = mkRow('c', '2');

    const next: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 20,
      total: 4,
      rows: [authA, authB, authD, authC],
      deltaRows: [deltaD],
      resources: [
        { resourceCd: '1', hasMore: false, total: 3, pageSize: 20 },
        { resourceCd: '2', hasMore: false, total: 1, pageSize: 20 }
      ]
    };

    const out = mergeLeaderboardBoardContinueResponseWithOptionalDelta([prevA, prevB, prevC], next, ['1', '2']);
    expect(out.rows.map((r) => r.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(out.rows[0]).toBe(prevA);
    expect(out.rows[1]).toBe(prevB);
    expect(out.rows[2]).toBe(deltaD);
    expect(out.rows[3]).toBe(prevC);
  });

  it('canMergeLeaderboardContinueDelta が false なら authority 参照をそのまま返す', () => {
    const prev = mkRow('a', '1');
    const auth = mkRow('a', '1');
    const next: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 20,
      total: 1,
      rows: [auth],
      deltaRows: [mkRow('x', '2')],
      resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 20 }]
    };
    expect(canMergeLeaderboardContinueDelta([prev], next, ['1'])).toBe(false);
    const out = mergeLeaderboardBoardContinueResponseWithOptionalDelta([prev], next, ['1']);
    expect(out.rows[0]).toBe(auth);
  });

  it('FSIGENCD パーティションが壊れていればフォールバックする', () => {
    const prev = mkRow('a', '1');
    const auth = mkRow('a', '1');
    const next: ProductionScheduleLeaderboardBoardResponse = {
      page: 1,
      pageSize: 20,
      total: 1,
      rows: [auth],
      deltaRows: [mkRow('x', '2')],
      resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 20 }]
    };
    const out = mergeLeaderboardBoardContinueResponseWithOptionalDelta([prev], next, ['1']);
    expect(out.rows[0]).toBe(auth);
  });
});

describe('partitionLeaderboardCompositeRowsBySlotOrder', () => {
  it('空スロットを挟んでもパーティションできる', () => {
    const r1 = mkRow('a', '1');
    const r2 = mkRow('b', '2');
    const parts = partitionLeaderboardCompositeRowsBySlotOrder([r1, r2], ['1', '2']);
    expect(parts).toEqual([[r1], [r2]]);
  });
});
