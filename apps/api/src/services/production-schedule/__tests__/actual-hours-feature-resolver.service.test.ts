import { describe, expect, it } from 'vitest';
import { createActualHoursFeatureResolver } from '../actual-hours-feature-resolver.service.js';

describe('actual-hours-feature-resolver.service', () => {
  it('strict一致を優先して返す', () => {
    const resolver = createActualHoursFeatureResolver({
      features: [
        { fhincd: 'MD0001', resourceCd: '26M', medianPerPieceMinutes: 10, p75PerPieceMinutes: null },
        { fhincd: 'MD0001', resourceCd: '25M', medianPerPieceMinutes: 7, p75PerPieceMinutes: null },
      ],
      resourceCodeMappings: [{ fromResourceCd: '26M', toResourceCd: '25M', priority: 1, enabled: true }],
    });

    const result = resolver.resolve({ fhincd: 'MD0001', resourceCd: '26M' });
    expect(result).toEqual({
      perPieceMinutes: 10,
      matchedBy: 'strict',
      matchedResourceCd: '26M',
    });
  });

  it('strict不一致時にmapping候補から解決する', () => {
    const resolver = createActualHoursFeatureResolver({
      features: [{ fhincd: 'MD0001', resourceCd: '25M', medianPerPieceMinutes: 7.5, p75PerPieceMinutes: null }],
      resourceCodeMappings: [{ fromResourceCd: '26M', toResourceCd: '25M', priority: 1, enabled: true }],
    });

    const result = resolver.resolve({ fhincd: 'MD0001', resourceCd: '26M' });
    expect(result).toEqual({
      perPieceMinutes: 7.5,
      matchedBy: 'mapped',
      matchedResourceCd: '25M',
    });
  });
});
