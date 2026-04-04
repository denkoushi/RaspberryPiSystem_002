import { describe, expect, it } from 'vitest';

import {
  classifyTemplateMatch,
  compareCandidates,
  isSelectableForSheetCreation,
  matchesSearchFilter,
  tokenForFhinmeiSimilarSearch
} from './template-candidate-rules.js';

describe('templateCandidateRules', () => {
  it('classifies exact_resource when fhincd and resource match', () => {
    expect(
      classifyTemplateMatch({
        scheduleFhincdNorm: 'ABC',
        scheduleResourceCdNorm: '587',
        templateFhincdNorm: 'ABC',
        templateResourceCdNorm: '587'
      })
    ).toBe('exact_resource');
  });

  it('classifies same_fhincd_other_resource when resource differs', () => {
    expect(
      classifyTemplateMatch({
        scheduleFhincdNorm: 'ABC',
        scheduleResourceCdNorm: '587',
        templateFhincdNorm: 'ABC',
        templateResourceCdNorm: '305'
      })
    ).toBe('same_fhincd_other_resource');
  });

  it('classifies fhinmei_similar when fhincd differs', () => {
    expect(
      classifyTemplateMatch({
        scheduleFhincdNorm: 'AAA',
        scheduleResourceCdNorm: '587',
        templateFhincdNorm: 'BBB',
        templateResourceCdNorm: '587'
      })
    ).toBe('fhinmei_similar');
  });

  it('all match kinds are selectable (clone-to-schedule-key lands on 3-element template)', () => {
    expect(isSelectableForSheetCreation('exact_resource')).toBe(true);
    expect(isSelectableForSheetCreation('same_fhincd_other_resource')).toBe(true);
    expect(isSelectableForSheetCreation('fhinmei_similar')).toBe(true);
  });

  it('compareCandidates orders by kind then version', () => {
    const a = { matchKind: 'same_fhincd_other_resource' as const, version: 99 };
    const b = { matchKind: 'exact_resource' as const, version: 1 };
    const c = { matchKind: 'exact_resource' as const, version: 2 };
    expect(compareCandidates(b, a)).toBeLessThan(0);
    expect(compareCandidates(c, b)).toBeLessThan(0);
  });

  it('tokenForFhinmeiSimilarSearch requires min length', () => {
    expect(tokenForFhinmeiSimilarSearch('')).toBeNull();
    expect(tokenForFhinmeiSimilarSearch('x')).toBeNull();
    expect(tokenForFhinmeiSimilarSearch('シャフト')).toBe('シャフト');
  });

  it('matchesSearchFilter', () => {
    const t = { fhincd: 'MD001', name: '表測定' };
    expect(matchesSearchFilter(undefined, t)).toBe(true);
    expect(matchesSearchFilter('', t)).toBe(true);
    expect(matchesSearchFilter('md001', t)).toBe(true);
    expect(matchesSearchFilter('測定', t)).toBe(true);
    expect(matchesSearchFilter('zzz', t)).toBe(false);
  });
});
