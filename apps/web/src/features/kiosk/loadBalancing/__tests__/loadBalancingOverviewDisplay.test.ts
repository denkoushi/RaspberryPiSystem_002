import { describe, expect, it } from 'vitest';

import {
  formatReductionMinutes,
  overviewOverCellClassName,
  overviewResourceRowClassName
} from '../loadBalancingOverviewDisplay';

describe('loadBalancingOverviewDisplay', () => {
  it('highlights over rows and formats reduction', () => {
    expect(overviewResourceRowClassName(120)).toContain('bg-amber-950/30');
    expect(overviewResourceRowClassName(0)).not.toContain('bg-amber-950/30');
    expect(overviewOverCellClassName(0)).toContain('text-white/50');
    expect(overviewOverCellClassName(10)).toContain('text-amber-200');

    expect(formatReductionMinutes(1000, 880)).toEqual({
      text: '-120分',
      className: expect.stringContaining('text-emerald-300')
    });
    expect(formatReductionMinutes(500, 500).text).toBe('変化なし');
  });
});
