import { describe, expect, it } from 'vitest';

import {
  formatPositiveReductionMinutes,
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
    expect(formatPositiveReductionMinutes(180)).toBe('-180分');
    expect(formatPositiveReductionMinutes(0)).toBe('0分');
  });
});
