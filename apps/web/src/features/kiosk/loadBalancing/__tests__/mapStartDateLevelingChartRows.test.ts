import { describe, expect, it } from 'vitest';

import { mapStartDateLevelingChartRows } from '../mapStartDateLevelingChartRows';

describe('mapStartDateLevelingChartRows', () => {
  it('builds stacked chart rows for top resources', () => {
    const { chartRows, resourceCds } = mapStartDateLevelingChartRows({
      bucketKeys: ['2026-05', '2026-06'],
      bucket: 'month',
      cells: [
        { resourceCd: 'A', bucketKey: '2026-05', requiredMinutes: 100, availableMinutes: 80, overMinutes: 20 },
        { resourceCd: 'B', bucketKey: '2026-05', requiredMinutes: 50, availableMinutes: null, overMinutes: 50 },
        { resourceCd: 'A', bucketKey: '2026-06', requiredMinutes: 30, availableMinutes: 80, overMinutes: 0 }
      ]
    });
    expect(resourceCds).toEqual(['A', 'B']);
    expect(chartRows).toHaveLength(2);
    expect(chartRows[0].A).toBe(100);
    expect(chartRows[1].A).toBe(30);
  });
});
