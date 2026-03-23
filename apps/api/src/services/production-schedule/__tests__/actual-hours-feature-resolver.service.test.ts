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

  it('strict/mapped不一致時にGroupCD候補から解決する', () => {
    const resolver = createActualHoursFeatureResolver({
      features: [{ fhincd: 'MD0001', resourceCd: '27M', medianPerPieceMinutes: 6.8, p75PerPieceMinutes: null }],
      resourceCodeMappings: [{ fromResourceCd: '26M', toResourceCd: '25M', priority: 1, enabled: true }],
      resourceGroupCandidatesByResourceCd: {
        '26M': ['26M', '27M']
      }
    });

    const result = resolver.resolve({ fhincd: 'MD0001', resourceCd: '26M' });
    expect(result).toEqual({
      perPieceMinutes: 6.8,
      matchedBy: 'grouped',
      matchedResourceCd: '27M'
    });
  });

  it('既定戦略では少数サンプルを資源中央値へ縮小する', () => {
    const resolver = createActualHoursFeatureResolver({
      features: [
        { fhincd: 'MD0001', resourceCd: '26M', sampleCount: 1, medianPerPieceMinutes: 10, p75PerPieceMinutes: 20 },
        { fhincd: 'MD0002', resourceCd: '26M', sampleCount: 20, medianPerPieceMinutes: 4, p75PerPieceMinutes: 7 },
      ],
    });

    const result = resolver.resolve({ fhincd: 'MD0001', resourceCd: '26M' });
    expect(result.perPieceMinutes).toBe(5.5);
  });

  it('legacyP75戦略では従来どおりp75優先で返す', () => {
    const resolver = createActualHoursFeatureResolver({
      features: [{ fhincd: 'MD0001', resourceCd: '26M', sampleCount: 3, medianPerPieceMinutes: 10, p75PerPieceMinutes: 20 }],
      strategy: 'legacyP75',
    });

    const result = resolver.resolve({ fhincd: 'MD0001', resourceCd: '26M' });
    expect(result.perPieceMinutes).toBe(20);
  });
});
