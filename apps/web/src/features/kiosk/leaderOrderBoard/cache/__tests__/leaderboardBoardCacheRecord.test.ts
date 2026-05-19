import { describe, expect, it } from 'vitest';

import { createEmptyAccumulatedLeaderboardDecorations } from '../../mergeLeaderboardBoardWithDecorations';
import {
  buildLeaderboardBoardCacheRecord,
  fingerprintLeaderboardBoardRowIds,
  isCompleteLeaderboardBoardSnapshot,
  parseLeaderboardBoardCacheRecord,
  serializeAccumulatedDecorations,
  deserializeAccumulatedDecorations
} from '../leaderboardBoardCacheRecord';

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

describe('leaderboardBoardCacheRecord', () => {
  it('完走版のみ build 可能', () => {
    const b = board({
      total: 2,
      rows: [{ id: 'a' }, { id: 'b' }] as ProductionScheduleLeaderboardBoardResponse['rows'],
      resources: [{ resourceCd: '1', hasMore: false, total: 2, pageSize: 80 }]
    });
    expect(isCompleteLeaderboardBoardSnapshot(b)).toBe(true);
    const rec = buildLeaderboardBoardCacheRecord({
      cacheKey: 'k',
      siteKey: 's',
      paramsKey: 'p',
      board: b,
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    });
    expect(rec).not.toBeNull();
    expect(rec!.rowIdsFingerprint).toBe('a\u0001b');
  });

  it('hasMore ありは build 不可', () => {
    const b = board({
      total: 10,
      rows: [{ id: 'a' }] as ProductionScheduleLeaderboardBoardResponse['rows'],
      resources: [{ resourceCd: '1', hasMore: true, total: 10, pageSize: 80 }]
    });
    expect(isCompleteLeaderboardBoardSnapshot(b)).toBe(false);
    expect(
      buildLeaderboardBoardCacheRecord({
        cacheKey: 'k',
        siteKey: 's',
        paramsKey: 'p',
        board: b,
        decorations: createEmptyAccumulatedLeaderboardDecorations()
      })
    ).toBeNull();
  });

  it('Map 装飾の serialize/deserialize 往復', () => {
    const acc = createEmptyAccumulatedLeaderboardDecorations();
    acc.rowDecorationsById.set('r1', { resolvedMachineName: 'M', customerName: 'C' });
    const ser = serializeAccumulatedDecorations(acc);
    const back = deserializeAccumulatedDecorations(ser);
    expect(back.rowDecorationsById.get('r1')).toEqual({
      resolvedMachineName: 'M',
      customerName: 'C'
    });
  });

  it('parse は fingerprint 不一致を拒否', () => {
    const b = board({
      total: 1,
      rows: [{ id: 'x' }] as ProductionScheduleLeaderboardBoardResponse['rows'],
      resources: [{ resourceCd: '1', hasMore: false, total: 1, pageSize: 80 }]
    });
    const rec = buildLeaderboardBoardCacheRecord({
      cacheKey: 'k',
      siteKey: 's',
      paramsKey: 'p',
      board: b,
      decorations: createEmptyAccumulatedLeaderboardDecorations()
    })!;
    const tampered = { ...rec, rowIdsFingerprint: 'wrong' };
    expect(parseLeaderboardBoardCacheRecord(tampered)).toBeNull();
    expect(parseLeaderboardBoardCacheRecord(rec)).not.toBeNull();
  });

  it('fingerprintLeaderboardBoardRowIds', () => {
    const b = board({
      rows: [{ id: '1' }, { id: '2' }] as ProductionScheduleLeaderboardBoardResponse['rows']
    });
    expect(fingerprintLeaderboardBoardRowIds(b)).toBe('1\u00012');
  });
});
