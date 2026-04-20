import { describe, expect, it } from 'vitest';

import { normalizePurchaseFhinCdForScheduleLookup } from '../purchase-fhincd-normalize.js';

describe('normalizePurchaseFhinCdForScheduleLookup', () => {
  it('strips parenthetical suffixes used in purchase CSV', () => {
    expect(normalizePurchaseFhinCdForScheduleLookup('MD000552918(A)')).toBe('MD000552918');
  });

  it('returns trimmed base when no parentheses', () => {
    expect(normalizePurchaseFhinCdForScheduleLookup('  MD100143500  ')).toBe('MD100143500');
  });
});
