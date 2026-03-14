import { describe, expect, it } from 'vitest';
import { productionScheduleDueManagementGlobalRankBodySchema } from '../shared.js';

describe('productionScheduleDueManagementGlobalRankBodySchema', () => {
  it('選択式 reasonCode を受け付ける', () => {
    const parsed = productionScheduleDueManagementGlobalRankBodySchema.parse({
      orderedFseibans: ['F001'],
      reasonCode: 'EXPEDITE_SPECIAL_PART',
    });
    expect(parsed.reasonCode).toBe('EXPEDITE_SPECIAL_PART');
  });

  it('未知の reasonCode は reject する', () => {
    expect(() =>
      productionScheduleDueManagementGlobalRankBodySchema.parse({
        orderedFseibans: ['F001'],
        reasonCode: 'UNSUPPORTED_REASON',
      })
    ).toThrow();
  });
});
