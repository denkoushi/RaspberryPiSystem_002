import { describe, expect, it } from 'vitest';

import { buildHaizenDueRows, buildHaizenUnplacedRows } from './haizenDueRows';

import type { HaizenOverviewRow } from '../../../api/domains/mobile-placement';

const placed = (id: string, fseiban: string, dueDate: string | null, updatedAt: string): HaizenOverviewRow => ({
  id, source: 'branch', shelfCodeRaw: 'S1', manufacturingOrderBarcodeRaw: id, branchNo: 1, fseiban, fhincd: id, fhinmei: id, machineName: null, verified: false, dueDate, sendOutDate: null, updatedAt
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
