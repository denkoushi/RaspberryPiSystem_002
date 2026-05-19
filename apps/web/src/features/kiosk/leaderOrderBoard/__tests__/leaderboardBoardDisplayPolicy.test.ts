import { describe, expect, it } from 'vitest';

import {
  fingerprintLeaderboardBoardShell,
  isLeaderboardScheduleInitialLoading,
  pickLeaderboardBoardForDisplay
} from '../leaderboardBoardDisplayPolicy';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../api/client';

function row(id: string): ProductionScheduleRow {
  return { id, rowData: { FSIGENCD: 'R1' } } as unknown as ProductionScheduleRow;
}

function board(rows: ProductionScheduleRow[], hasMore = false): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: rows.length,
    rows,
    resources: [{ resourceCd: 'R1', hasMore, total: rows.length, pageSize: 80 }]
  };
}

describe('pickLeaderboardBoardForDisplay', () => {
  it('追補済み行数が shell より多いときは追補結果を維持する', () => {
    const shell = board([row('a'), row('b')], true);
    const override = board([row('a'), row('b'), row('c')], false);
    const picked = pickLeaderboardBoardForDisplay(shell, override);
    expect(picked?.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('fingerprintLeaderboardBoardShell', () => {
  it('行 ID と resources が同じなら同一指紋', () => {
    const a = board([row('a'), row('b')], true);
    const b = board([row('a'), row('b')], true);
    expect(fingerprintLeaderboardBoardShell(a)).toBe(fingerprintLeaderboardBoardShell(b));
  });
});

describe('isLeaderboardScheduleInitialLoading', () => {
  it('行がある限り初回ローディングにしない', () => {
    expect(isLeaderboardScheduleInitialLoading(true, 3)).toBe(false);
    expect(isLeaderboardScheduleInitialLoading(true, 0)).toBe(true);
  });
});
