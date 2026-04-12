import { describe, expect, it } from 'vitest';

import { partSearchHitIdentity } from '../partSearchIdentity';

import type { PartPlacementSearchHitDto } from '../types';

const base: PartPlacementSearchHitDto = {
  matchSource: 'schedule',
  displayName: 'x',
  matchedQuery: 'q',
  aliasMatchedBy: null,
  shelfCodeRaw: null,
  manufacturingOrderBarcodeRaw: null,
  branchNo: null,
  branchStateId: null,
  csvDashboardRowId: 'row-1',
  fhincd: null,
  fhinmei: null,
  fseiban: null,
  productNo: null
};

describe('partSearchHitIdentity', () => {
  it('uses branchStateId for current', () => {
    expect(
      partSearchHitIdentity({
        ...base,
        matchSource: 'current',
        branchStateId: 'bs-1',
        csvDashboardRowId: 'row-1'
      })
    ).toBe('current:bs-1');
  });

  it('uses csvDashboardRowId for schedule', () => {
    expect(partSearchHitIdentity(base)).toBe('schedule:row-1');
  });
});
