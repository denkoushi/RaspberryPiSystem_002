import { describe, expect, it, vi } from 'vitest';

import { assembleStartDateLevelingResult } from '../start-date-leveling-assembler.js';
import type { StartDateLevelingQueryRow } from '../start-date-leveling.types.js';

vi.mock('../load-balancing-settings.service.js', () => ({
  buildWorkCalendarModeMap: (items: Array<{ resourceCd: string; workCalendarMode: 'weekdays' | 'calendar_days' }>) =>
    new Map(items.map((item) => [item.resourceCd, item.workCalendarMode])),
  listLoadBalancingCapacityBase: vi.fn(async (siteKeyInput: string) => ({
    siteKey: siteKeyInput,
    items: []
  })),
  listLoadBalancingMonthlyCapacity: vi.fn(async () => ({
    items: []
  })),
  listLoadBalancingWorkCalendars: vi.fn(async () => ({
    items: []
  }))
}));

describe('assembleStartDateLevelingResult', () => {
  it('着手日または有効納期が欠損した行を未配分として返す', async () => {
    const rows: StartDateLevelingQueryRow[] = [
      {
        rowId: 'missing-start',
        fseiban: 'S001',
        productNo: 'P001',
        fhincd: 'H001',
        fkojun: '10',
        resourceCd: 'A01',
        perUnitMinutes: 10,
        plannedQuantity: 2,
        plannedStartDate: null,
        effectiveDueDate: new Date('2026-05-20T00:00:00.000Z')
      },
      {
        rowId: 'missing-due',
        fseiban: 'S002',
        productNo: 'P002',
        fhincd: 'H002',
        fkojun: '20',
        resourceCd: 'A01',
        perUnitMinutes: 10,
        plannedQuantity: 2,
        plannedStartDate: new Date('2026-05-01T00:00:00.000Z'),
        effectiveDueDate: null
      }
    ];

    const result = await assembleStartDateLevelingResult({
      siteKeyInput: '第2工場',
      deviceScopeKey: 'mac',
      fromMonth: '2026-05',
      toMonth: '2026-05',
      bucket: 'month',
      queryRows: rows
    });

    expect(result.allocatedRows).toHaveLength(0);
    expect(result.unallocatedRows.map((row) => [row.rowId, row.reason])).toEqual([
      ['missing-start', 'missing_planned_start_date'],
      ['missing-due', 'missing_effective_due_date']
    ]);
  });
});
