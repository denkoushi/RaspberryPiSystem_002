import { describe, expect, it } from 'vitest';

import {
  parsePurchaseOrderLookupRow,
  shouldReplacePurchaseOrderLookupRow,
} from '../purchase-order-lookup-sync.pipeline.js';

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

  it('reads FKOBAIST as purchaseStatus and keeps null when the column is absent', () => {
    const base = { FKOBAINO: '0005507676', FHINCD: 'MD000552918-001', FSEIBAN: 'CA1QAS09', FKOBAIHINMEI: '品名' };
    expect(parsePurchaseOrderLookupRow({ ...base, FKOBAIST: ' c ' }, 0)?.purchaseStatus).toBe('C');
    expect(parsePurchaseOrderLookupRow({ ...base, FKOBAIST: '' }, 0)?.purchaseStatus).toBeNull();
    expect(parsePurchaseOrderLookupRow(base, 0)?.purchaseStatus).toBeNull();
  });

  it('reads FUPDTEDT as a JST wall clock and keeps null when it is blank or unreadable', () => {
    const base = { FKOBAINO: '0005507676', FHINCD: 'MD000552918-001', FSEIBAN: 'CA1QAS09', FKOBAIHINMEI: '品名' };
    expect(
      parsePurchaseOrderLookupRow({ ...base, FUPDTEDT: '2026-09-29T20:33:57' }, 0)?.sourceUpdatedAt?.toISOString()
    ).toBe('2026-09-29T11:33:57.000Z');
    expect(parsePurchaseOrderLookupRow({ ...base, FUPDTEDT: '' }, 0)?.sourceUpdatedAt).toBeNull();
    expect(parsePurchaseOrderLookupRow({ ...base, FUPDTEDT: '2026/09/29' }, 0)?.sourceUpdatedAt).toBeNull();
    expect(parsePurchaseOrderLookupRow(base, 0)?.sourceUpdatedAt).toBeNull();
  });

  it('returns null when FKOBAINO is not 10 digits', () => {
    expect(parsePurchaseOrderLookupRow({ FKOBAINO: '123' }, 0)).toBeNull();
  });
});

describe('shouldReplacePurchaseOrderLookupRow', () => {
  const at = (iso: string | null) => ({ sourceUpdatedAt: iso == null ? null : new Date(iso) });

  it('takes the newer row, and the later row on a tie or when neither has a date', () => {
    expect(shouldReplacePurchaseOrderLookupRow(at('2026-09-01T00:00:00Z'), at('2026-09-02T00:00:00Z'))).toBe(true);
    expect(shouldReplacePurchaseOrderLookupRow(at('2026-09-02T00:00:00Z'), at('2026-09-01T00:00:00Z'))).toBe(false);
    expect(shouldReplacePurchaseOrderLookupRow(at('2026-09-01T00:00:00Z'), at('2026-09-01T00:00:00Z'))).toBe(true);
    expect(shouldReplacePurchaseOrderLookupRow(at(null), at(null))).toBe(true);
  });

  it('never lets an undated row replace a dated one', () => {
    expect(shouldReplacePurchaseOrderLookupRow(at('2026-09-01T00:00:00Z'), at(null))).toBe(false);
    expect(shouldReplacePurchaseOrderLookupRow(at(null), at('2026-09-01T00:00:00Z'))).toBe(true);
  });
});
