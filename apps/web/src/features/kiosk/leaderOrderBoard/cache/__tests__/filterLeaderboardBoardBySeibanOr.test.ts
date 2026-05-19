import { describe, expect, it } from 'vitest';

import { filterLeaderboardBoardBySeibanOr } from '../filterLeaderboardBoardBySeibanOr';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../../api/client';

function row(id: string, resourceCd: string, fseiban: string): ProductionScheduleRow {
  return {
    id,
    fseiban,
    rowData: { FSIGENCD: resourceCd, FSEIBAN: fseiban, ProductNo: id }
  } as unknown as ProductionScheduleRow;
}

function board(
  rows: ProductionScheduleRow[],
  resources: ProductionScheduleLeaderboardBoardResponse['resources']
): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: rows.length,
    rows,
    resources
  };
}

describe('filterLeaderboardBoardBySeibanOr', () => {
  const ordered = ['R1', 'R2'] as const;

  it('空トークンは board をそのまま返す', () => {
    const b = board([row('a', 'R1', 'AA111111')], [
      { resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 }
    ]);
    expect(filterLeaderboardBoardBySeibanOr(b, [], ordered)).toBe(b);
  });

  it('OR: いずれかの製番に一致する行のみ残しスロット別 total を再計算', () => {
    const b = board(
      [row('a', 'R1', 'AA111111'), row('b', 'R1', 'BB222222'), row('c', 'R2', 'AA111111')],
      [
        { resourceCd: 'R1', hasMore: false, total: 2, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, total: 1, pageSize: 80 }
      ]
    );
    const filtered = filterLeaderboardBoardBySeibanOr(b, ['AA111111'], ordered);
    expect(filtered?.rows.map((r) => r.id)).toEqual(['a', 'c']);
    expect(filtered?.total).toBe(2);
    expect(filtered?.resources[0]?.total).toBe(1);
    expect(filtered?.resources[1]?.total).toBe(1);
    expect(filtered?.resources.every((r) => !r.hasMore)).toBe(true);
  });

  it('複数製番 OR', () => {
    const b = board(
      [row('a', 'R1', 'AA111111'), row('b', 'R1', 'BB222222'), row('c', 'R2', 'CC333333')],
      [
        { resourceCd: 'R1', hasMore: false, total: 2, pageSize: 80 },
        { resourceCd: 'R2', hasMore: false, total: 1, pageSize: 80 }
      ]
    );
    const filtered = filterLeaderboardBoardBySeibanOr(b, ['AA111111', 'CC333333'], ordered);
    expect(filtered?.rows.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('スロット順が壊れていれば null', () => {
    const b = board([row('a', 'R2', 'AA111111'), row('b', 'R1', 'AA111111')], [
      { resourceCd: 'R1', hasMore: false, total: 1, pageSize: 80 },
      { resourceCd: 'R2', hasMore: false, total: 1, pageSize: 80 }
    ]);
    expect(filterLeaderboardBoardBySeibanOr(b, ['AA111111'], ordered)).toBeNull();
  });
});
