import { describe, expect, it } from 'vitest';

import { buildLeaderboardDecorationFetchBatches } from '../useLeaderboardDeferredBoardDecorations';

import type {
  LeaderboardBoardResourceSliceResponse,
  ProductionScheduleRow
} from '../../../../api/client';

function row(id: string, resourceCd: string): ProductionScheduleRow {
  return {
    id,
    occurredAt: '2026-06-16T00:00:00.000Z',
    rowData: {
      FSIGENCD: resourceCd,
      ProductNo: id,
      FSEIBAN: `S-${id}`,
      FHINCD: `P-${id}`
    }
  };
}

function resource(resourceCd: string): LeaderboardBoardResourceSliceResponse {
  return {
    resourceCd,
    hasMore: false,
    total: 0,
    pageSize: 80
  };
}

describe('buildLeaderboardDecorationFetchBatches', () => {
  it('スロット順に各資源の上位行を優先バッチへ入れる', () => {
    const r1Rows = Array.from({ length: 10 }, (_, index) => row(`r1-${index + 1}`, 'R1'));
    const r2Rows = Array.from({ length: 10 }, (_, index) => row(`r2-${index + 1}`, 'R2'));
    const rows = [...r1Rows, ...r2Rows];

    const result = buildLeaderboardDecorationFetchBatches({
      rows,
      resources: [resource('R2'), resource('R1')],
      pendingRowIds: rows.map((r) => r.id)
    });

    expect(result.priorityRowIds).toEqual([
      'r2-1',
      'r2-2',
      'r2-3',
      'r2-4',
      'r2-5',
      'r2-6',
      'r2-7',
      'r2-8',
      'r1-1',
      'r1-2',
      'r1-3',
      'r1-4',
      'r1-5',
      'r1-6',
      'r1-7',
      'r1-8'
    ]);
    expect(result.backgroundRowIdBatches).toEqual([
      ['r1-9', 'r1-10', 'r2-9', 'r2-10']
    ]);
  });

  it('資源順が解決できないときも先頭バッチを返す', () => {
    const rows = Array.from({ length: 3 }, (_, index) => row(`r-${index + 1}`, 'R1'));

    const result = buildLeaderboardDecorationFetchBatches({
      rows,
      resources: [],
      pendingRowIds: rows.map((r) => r.id)
    });

    expect(result.priorityRowIds).toEqual(['r-1', 'r-2', 'r-3']);
    expect(result.backgroundRowIdBatches).toEqual([]);
  });

  it('rowId と資源コードの前後空白を正規化して優先バッチを作る', () => {
    const rows = [row(' r-1 ', ' R1 '), row('r-2', 'R1')];

    const result = buildLeaderboardDecorationFetchBatches({
      rows,
      resources: [resource(' R1 ')],
      pendingRowIds: [' r-1 ', 'r-2']
    });

    expect(result.priorityRowIds).toEqual(['r-1', 'r-2']);
    expect(result.backgroundRowIdBatches).toEqual([]);
  });
});
