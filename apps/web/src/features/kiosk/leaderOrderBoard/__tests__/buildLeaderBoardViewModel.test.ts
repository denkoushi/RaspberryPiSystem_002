import { describe, expect, it } from 'vitest';

import { buildLeaderBoardGroupedRows, buildLeaderBoardSortedGrouped } from '../buildLeaderBoardViewModel';

import type { ProductionScheduleRow } from '../../../../api/client';

const mk = (
  id: string,
  resourceCd: string,
  fseiban: string,
  processingOrder: number | null,
  progress: string,
  dueDate: string | null = '2026-02-01'
): ProductionScheduleRow => ({
  id,
  occurredAt: '2026-01-01T00:00:00.000Z',
  rowData: {
    FSIGENCD: resourceCd,
    FSEIBAN: fseiban,
    ProductNo: 'P1',
    FHINCD: 'K001',
    FHINMEI: '品',
    FKOJUN: '1',
    progress
  },
  processingOrder,
  dueDate,
  plannedEndDate: null
});

describe('buildLeaderBoardViewModel', () => {
  it('groups by resource and places manual processingOrder before null', () => {
    const rows = [
      mk('a', 'R1', 'S1', null, '', '2026-03-01'),
      mk('b', 'R1', 'S2', 1, '', '2026-02-01')
    ];
    const grouped = buildLeaderBoardGroupedRows(rows, undefined);
    const sorted = buildLeaderBoardSortedGrouped(grouped, 'all');
    const list = sorted.get('R1') ?? [];
    expect(list.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('filters completed rows when completionFilter is incomplete', () => {
    const rows = [mk('c1', 'R1', 'S1', null, '完了'), mk('c2', 'R1', 'S2', null, '')];
    const grouped = buildLeaderBoardGroupedRows(rows, undefined);
    const sorted = buildLeaderBoardSortedGrouped(grouped, 'incomplete');
    const list = sorted.get('R1') ?? [];
    expect(list.map((r) => r.id)).toEqual(['c2']);
  });
});
