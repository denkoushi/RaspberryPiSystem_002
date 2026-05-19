import { describe, expect, it } from 'vitest';

import {
  fingerprintLeaderboardBoardContent,
  shouldSkipCachePut
} from '../leaderboardBoardCachePersistPolicy';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function board(rows: Array<{ id: string; order?: number | null; note?: string | null }>) {
  return {
    page: 1,
    pageSize: 80,
    total: rows.length,
    rows: rows.map((r) => ({
      id: r.id,
      processingOrder: r.order ?? null,
      note: r.note ?? null,
      rowData: { progress: '未' }
    })),
    resources: [{ resourceCd: '1', hasMore: false, total: rows.length, pageSize: 80 }]
  } as ProductionScheduleLeaderboardBoardResponse;
}

describe('leaderboardBoardCachePersistPolicy', () => {
  it('fingerprintLeaderboardBoardContent は順位変更で変わる', () => {
    const a = fingerprintLeaderboardBoardContent(board([{ id: 'r1', order: 1 }]));
    const b = fingerprintLeaderboardBoardContent(board([{ id: 'r1', order: 2 }]));
    expect(a).not.toBe(b);
  });

  it('shouldSkipCachePut は内容同一なら true', () => {
    const fp = fingerprintLeaderboardBoardContent(board([{ id: 'r1', order: 1 }]));
    expect(shouldSkipCachePut({ lastContentFingerprint: fp, nextContentFingerprint: fp })).toBe(true);
    expect(
      shouldSkipCachePut({
        lastContentFingerprint: fp,
        nextContentFingerprint: fingerprintLeaderboardBoardContent(board([{ id: 'r1', order: 2 }]))
      })
    ).toBe(false);
  });
});
