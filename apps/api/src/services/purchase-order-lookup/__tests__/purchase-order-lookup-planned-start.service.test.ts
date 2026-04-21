import { describe, expect, it } from 'vitest';

import { purchaseOrderLookupSeibanNormKey } from '../purchase-order-lookup-planned-start.service.js';

describe('purchaseOrderLookupSeibanNormKey', () => {
  it('trims seiban and normalized FHINCD and joins with tab', () => {
    expect(purchaseOrderLookupSeibanNormKey('  BA1S1234  ', '  MD001  ')).toBe('BA1S1234\tMD001');
  });
});
