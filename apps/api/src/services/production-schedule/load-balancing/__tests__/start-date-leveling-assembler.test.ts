import { describe, expect, it, vi } from 'vitest';

import { assembleStartDateLevelingResult } from '../start-date-leveling-assembler.js';
import type { StartDateLevelingQueryRow } from '../start-date-leveling.types.js';
import { parseUtcDateKey } from '../work-calendar-policy.js';

vi.mock('../load-balancing-settings.service.js', () => ({
  listLoadBalancingCapacityBaseResolved: vi.fn().mockResolvedValue({
    siteKey: '第2工場',
    items: [{ resourceCd: '033', baseAvailableMinutes: 10000 }]
  }),
  listLoadBalancingMonthlyCapacityResolved: vi.fn().mockResolvedValue({
    items: [{ resourceCd: '033', availableMinutes: 10000 }]
  }),
  listLoadBalancingWorkCalendarsResolved: vi.fn().mockResolvedValue({
    items: [{ resourceCd: '033', workCalendarMode: 'weekdays' as const }]
  }),
  buildWorkCalendarModeMap: vi.fn().mockReturnValue(new Map([['033', 'weekdays' as const]]))
}));

function makeRow(overrides: Partial<StartDateLevelingQueryRow> = {}): StartDateLevelingQueryRow {
  return {
    rowId: 'row-1',
    fseiban: 'S1',
    productNo: '1',
    fhincd: 'P1',
    fkojun: '10',
    resourceCd: '033',
    requiredMinutes: 100,
    plannedStartDate: parseUtcDateKey('2026-05-04'),
    effectiveDueDate: parseUtcDateKey('2026-05-08'),
    ...overrides
  };
}

describe('assembleStartDateLevelingResult', () => {
  it('uses requiredMinutes as row total without multiplying plannedQuantity', async () => {
    const result = await assembleStartDateLevelingResult({
      siteKeyInput: '第2工場',
      deviceScopeKey: 'mac',
      fromMonth: '2026-05',
      toMonth: '2026-05',
      bucket: 'month',
      queryRows: [makeRow({ requiredMinutes: 100 })]
    });

    expect(result.allocatedRows).toHaveLength(1);
    expect(result.allocatedRows[0]?.totalMinutes).toBe(100);
    const mayCell = result.cells.find(
      (cell) => cell.resourceCd === '033' && cell.bucketKey === '2026-05'
    );
    expect(mayCell?.requiredMinutes).toBeCloseTo(100, 5);
  });

  it('does not require plannedQuantity; zero requiredMinutes is unallocated', async () => {
    const result = await assembleStartDateLevelingResult({
      siteKeyInput: '第2工場',
      deviceScopeKey: 'mac',
      fromMonth: '2026-05',
      toMonth: '2026-05',
      bucket: 'month',
      queryRows: [makeRow({ requiredMinutes: 0 })]
    });

    expect(result.allocatedRows).toHaveLength(0);
    expect(result.unallocatedRows).toHaveLength(1);
    expect(result.unallocatedRows[0]?.reason).toBe('zero_required_minutes');
  });

  it('surfaces missing planned start date and effective due date as unallocated', async () => {
    const result = await assembleStartDateLevelingResult({
      siteKeyInput: '第2工場',
      deviceScopeKey: 'mac',
      fromMonth: '2026-05',
      toMonth: '2026-05',
      bucket: 'month',
      queryRows: [
        makeRow({ rowId: 'no-start', plannedStartDate: null }),
        makeRow({ rowId: 'no-due', effectiveDueDate: null })
      ]
    });

    expect(result.allocatedRows).toHaveLength(0);
    expect(result.unallocatedRows).toHaveLength(2);
    expect(result.unallocatedRows.find((r) => r.rowId === 'no-start')?.reason).toBe(
      'missing_planned_start_date'
    );
    expect(result.unallocatedRows.find((r) => r.rowId === 'no-due')?.reason).toBe(
      'missing_effective_due_date'
    );
  });
});
