import { describe, expect, it } from 'vitest';

import { mapOverviewResourceChartRows } from '../mapOverviewResourceChartRows';

describe('mapOverviewResourceChartRows', () => {
  it('必要分降順で上位 maxRows 件を返す', () => {
    const rows = mapOverviewResourceChartRows(
      [
        { resourceCd: 'A', requiredMinutes: 100, availableMinutes: 50, overMinutes: 50 },
        { resourceCd: 'B', requiredMinutes: 300, availableMinutes: 100, overMinutes: 200 },
        { resourceCd: 'C', requiredMinutes: 200, availableMinutes: null, overMinutes: 200 }
      ],
      { B: ['機種B'], C: ['機種C'] },
      2
    );

    expect(rows).toHaveLength(2);
    expect(rows[0]?.cd).toBe('B');
    expect(rows[0]?.displayName).toBe('機種B');
    expect(rows[1]?.cd).toBe('C');
    expect(rows[1]?.cap).toBe(0);
  });
});
