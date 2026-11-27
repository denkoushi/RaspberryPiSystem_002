import { describe, expect, it } from 'vitest';

import { buildHaizenDueGroups, buildHaizenDueRows, buildHaizenUnplacedRows } from './haizenDueRows';

import type { HaizenOverviewRow } from '../../../api/domains/mobile-placement';

const placed = (id: string, fseiban: string, dueDate: string | null, updatedAt: string): HaizenOverviewRow => ({
  id, source: 'branch', shelfCodeRaw: 'S1', manufacturingOrderBarcodeRaw: id, branchNo: 1, fseiban, fhincd: id, fhinmei: id, machineName: null, verified: false, dueDate, sendOutDate: null, updatedAt
});

describe('buildHaizenDueGroups', () => {
  it('puts registered seibans in board order, then uses earliest due date and places undated groups last', () => {
    const updated = '2026-11-01T00:00:00Z';
    const byDate = [placed('1', 'UNDATED', null, updated), placed('2', 'B', '2026-11-02', updated),
      placed('3', 'A', '2026-11-04', updated), placed('4', 'C', '2026-11-03', updated),
      placed('5', 'D', '2026-11-06', updated), placed('6', 'C', '2026-11-01', updated)];
    const result = buildHaizenDueGroups(byDate, ['D', 'A'], []);
    expect(result.map(group => [group.fseiban, group.dueDate])).toEqual([
      ['D', '2026-11-06'], ['A', '2026-11-04'], ['C', '2026-11-01'], ['B', '2026-11-02'], ['UNDATED', null]
    ]);
  });

  it('counts verified and placed independently, excluding a whole seiban and keeping unknown rows', () => {
    const updated = '2026-11-01T00:00:00Z';
    const rows = [
      { ...placed('1', 'A', null, updated), verified: true },
      { ...placed('2', 'A', null, updated), verified: true, unplaced: true },
      { ...placed('3', 'A', null, updated), unplaced: true },
      placed('4', 'B', null, updated), { ...placed('5', '', null, updated), fseiban: null }
    ];
    const result = buildHaizenDueGroups(rows, ['A', 'B'], ['B']);
    expect(result.map(group => group.fseiban)).toEqual(['A', null]);
    expect(result[0]).toMatchObject({ placed: 1, verified: 2 });
    expect(result[0].rows.map(row => row.id)).toEqual(['3', '2', '1']);
  });
});

describe('buildHaizenDueRows', () => {
  it('orders seibans by earliest due date, undated last, and unplaced before placed within a seiban', () => {
    const unplaced = buildHaizenUnplacedRows([{ fseiban: 'A', productNo: '9', fhincd: 'U', fhinmei: 'u', verified: false, machineName: null, dueDate: '2026-11-07' }]);
    const result = buildHaizenDueRows([
      placed('1', 'NONE', null, '2026-11-01T00:00:00Z'),
      placed('2', 'B', '2026-11-10', '2026-11-01T00:00:00Z'),
      placed('3', 'A', '2026-11-07', '2026-11-01T00:00:00Z')
    ], unplaced);
    expect(result.map(row => row.id)).toEqual(['A:9', '3', '2', '1']);
  });
});
