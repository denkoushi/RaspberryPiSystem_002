import { describe, expect, it } from 'vitest';

import { availableProcessingOrderOptions } from '../availableProcessingOrderOptions';

describe('availableProcessingOrderOptions', () => {
  it('returns numbers not in usage except current', () => {
    const usageNumbers = [1, 3, 5];
    expect(availableProcessingOrderOptions('R1', 3, usageNumbers)).toEqual([2, 3, 4, 6, 7, 8, 9, 10]);
    expect(availableProcessingOrderOptions('R1', null, usageNumbers)).toEqual([2, 4, 6, 7, 8, 9, 10]);
  });

  it('returns empty when resourceCd empty', () => {
    expect(availableProcessingOrderOptions('', 1, [])).toEqual([]);
  });
});
