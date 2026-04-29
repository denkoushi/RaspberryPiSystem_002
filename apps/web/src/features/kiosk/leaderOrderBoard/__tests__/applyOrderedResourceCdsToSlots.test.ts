import { describe, expect, it } from 'vitest';

import {
  applyOrderedResourceCdsToSlots,
  normalizeDistinctOrderedResourceCds
} from '../applyOrderedResourceCdsToSlots';

describe('normalizeDistinctOrderedResourceCds', () => {
  it('dedupes with first-wins ordering', () => {
    expect(normalizeDistinctOrderedResourceCds([' A ', '305', '', '305', '401'])).toEqual(['A', '305', '401']);
  });
});

describe('applyOrderedResourceCdsToSlots', () => {
  it('lays out unique ordered CDs across fixed slotCount', () => {
    expect(applyOrderedResourceCdsToSlots(4, ['305', '305', '401'])).toEqual(['305', '401', null, null]);
  });

  it('truncates when server returns more CDs than slots', () => {
    expect(applyOrderedResourceCdsToSlots(3, ['1', '2', '3', '4', '5'])).toEqual(['1', '2', '3']);
  });
});
