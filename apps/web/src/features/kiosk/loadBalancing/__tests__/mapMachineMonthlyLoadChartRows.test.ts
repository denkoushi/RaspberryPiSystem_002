import { describe, expect, it } from 'vitest';

import { mapMachineMonthlyLoadChartRows } from '../mapMachineMonthlyLoadChartRows';

describe('mapMachineMonthlyLoadChartRows', () => {
  it('builds stacked rows per month with zero-filled resources', () => {
    const { chartRows, resourceCds } = mapMachineMonthlyLoadChartRows({
      months: ['2026-06', '2026-07'],
      resourceMonths: [
        { month: '2026-06', resourceCd: 'A01', requiredMinutes: 100 },
        { month: '2026-07', resourceCd: 'B02', requiredMinutes: 40 },
        { month: '2026-07', resourceCd: 'A01', requiredMinutes: 10 }
      ]
    });

    expect(resourceCds).toEqual(['A01', 'B02']);
    expect(chartRows).toEqual([
      { month: '2026-06', A01: 100, B02: 0 },
      { month: '2026-07', A01: 10, B02: 40 }
    ]);
  });
});
