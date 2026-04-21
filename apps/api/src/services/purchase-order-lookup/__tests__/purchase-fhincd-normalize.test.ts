import { describe, expect, it } from 'vitest';

import {
  normalizePurchaseFhinCdForMatching,
  normalizePurchaseFhinCdForScheduleLookup,
  stripTrailingNumericHyphenSuffixes,
} from '../purchase-fhincd-normalize.js';

describe('normalizePurchaseFhinCdForScheduleLookup', () => {
  it('strips parenthetical suffixes used in purchase CSV', () => {
    expect(normalizePurchaseFhinCdForScheduleLookup('MD000552918(A)')).toBe('MD000552918');
  });

  it('returns trimmed base when no parentheses', () => {
    expect(normalizePurchaseFhinCdForScheduleLookup('  MD100143500  ')).toBe('MD100143500');
  });
});

describe('stripTrailingNumericHyphenSuffixes', () => {
  it('removes trailing -001 style segments', () => {
    expect(stripTrailingNumericHyphenSuffixes('MD000552918-001')).toBe('MD000552918');
  });

  it('removes chained numeric suffixes -001-1', () => {
    expect(stripTrailingNumericHyphenSuffixes('MD000552918-001-1')).toBe('MD000552918');
  });

  it('keeps -SA and -002T (non-numeric-only tails)', () => {
    expect(stripTrailingNumericHyphenSuffixes('PART-SA')).toBe('PART-SA');
    expect(stripTrailingNumericHyphenSuffixes('MD-002T')).toBe('MD-002T');
  });
});

describe('normalizePurchaseFhinCdForMatching', () => {
  it('applies parens strip then numeric suffix strip (0005507676 系)', () => {
    // 購買が MD...-001、生産日程が MD... のとき照合キーで一致させる
    expect(normalizePurchaseFhinCdForMatching('MD000552918-001')).toBe('MD000552918');
  });

  it('handles parens before numeric suffix', () => {
    expect(normalizePurchaseFhinCdForMatching('MD000552918(A)-001')).toBe('MD000552918');
  });

  it('does not strip -SA / -002T', () => {
    expect(normalizePurchaseFhinCdForMatching('X-SA')).toBe('X-SA');
    expect(normalizePurchaseFhinCdForMatching('MD-002T')).toBe('MD-002T');
  });
});
