import { describe, expect, it } from 'vitest';

import { parsePurchaseOrderLookupRow } from '../purchase-order-lookup-sync.pipeline.js';

describe('parsePurchaseOrderLookupRow', () => {
  it('parses valid FKOBAINO row', () => {
    const row = {
      FKOBAINO: '0005059741',
      FHINCD: 'MD100143500',
      FSEIBAN: 'CA1QAS09',
      FKOBAIHINMEI: 'ボール（MW2測定用）',
      FUPDTEDT: '',
      FKENSAOKSU: '0',
    };
    const p = parsePurchaseOrderLookupRow(row, 0);
    expect(p).not.toBeNull();
    expect(p?.purchaseOrderNo).toBe('0005059741');
    expect(p?.purchasePartCodeNormalized).toBe('MD100143500');
    expect(p?.acceptedQuantity).toBe(0);
  });

  it('returns null when FKOBAINO is not 10 digits', () => {
    expect(parsePurchaseOrderLookupRow({ FKOBAINO: '123' }, 0)).toBeNull();
  });
});
