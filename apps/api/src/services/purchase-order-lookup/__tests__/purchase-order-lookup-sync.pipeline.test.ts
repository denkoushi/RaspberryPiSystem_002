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
    expect(p?.purchasePartCodeMatchKey).toBe('MD100143500');
    expect(p?.acceptedQuantity).toBe(0);
  });

  it('sets purchasePartCodeMatchKey without MD...-001 numeric branch (0005507676 相当)', () => {
    const row = {
      FKOBAINO: '0005507676',
      FHINCD: 'MD000552918-001',
      FSEIBAN: 'CA1QAS09',
      FKOBAIHINMEI: '品名',
      FUPDTEDT: '',
      FKENSAOKSU: '1',
    };
    const p = parsePurchaseOrderLookupRow(row, 0);
    expect(p).not.toBeNull();
    expect(p?.purchaseOrderNo).toBe('0005507676');
    expect(p?.purchasePartCodeNormalized).toBe('MD000552918-001');
    expect(p?.purchasePartCodeMatchKey).toBe('MD000552918');
  });

  it('returns null when FKOBAINO is not 10 digits', () => {
    expect(parsePurchaseOrderLookupRow({ FKOBAINO: '123' }, 0)).toBeNull();
  });
});
