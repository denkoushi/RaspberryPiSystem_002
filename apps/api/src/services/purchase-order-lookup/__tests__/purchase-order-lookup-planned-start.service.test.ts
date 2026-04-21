import { describe, expect, it } from 'vitest';

import { purchaseOrderLookupSeibanMatchKey } from '../purchase-order-lookup-planned-start.service.js';

describe('purchaseOrderLookupSeibanMatchKey', () => {
  it('trims seiban and match-key FHINCD and joins with tab', () => {
    expect(purchaseOrderLookupSeibanMatchKey('  BA1S1234  ', '  MD001  ')).toBe('BA1S1234\tMD001');
  });
});
