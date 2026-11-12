import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  isManufacturingOrderNo,
  isPurchaseOrderNo,
  manufacturingOrderNoSchema,
  normalizeManufacturingOrderScanText,
  purchaseOrderNoSchema
} from './manufacturing-order-no.js';

describe('normalizeManufacturingOrderScanText', () => {
  it('trims scanner framing characters', () => {
    expect(normalizeManufacturingOrderScanText('\r\n0002178005\n')).toBe('0002178005');
  });

  it('removes non-digit symbols added by the scanner', () => {
    expect(normalizeManufacturingOrderScanText('0002178005*')).toBe('0002178005');
    expect(normalizeManufacturingOrderScanText('*0002178005#\t')).toBe('0002178005');
    expect(normalizeManufacturingOrderScanText('0002178005　A')).toBe('0002178005');
  });

  it('keeps the single 10-digit run when the scanner appends extra characters', () => {
    expect(normalizeManufacturingOrderScanText('0004151384$200%')).toBe('0004151384');
    expect(normalizeManufacturingOrderScanText('$12%0004151384')).toBe('0004151384');
  });

  it('rejects ambiguous scans with several 10-digit runs or digits glued to the order', () => {
    expect(normalizeManufacturingOrderScanText('0004151384$0002178005')).toBeNull();
    expect(normalizeManufacturingOrderScanText('0004151384200')).toBeNull();
  });

  it('converts full-width digits', () => {
    expect(normalizeManufacturingOrderScanText('０００２１７８００５')).toBe('0002178005');
  });

  it('rejects values that are not exactly 10 digits', () => {
    expect(normalizeManufacturingOrderScanText('')).toBeNull();
    expect(normalizeManufacturingOrderScanText('*#')).toBeNull();
    expect(normalizeManufacturingOrderScanText('000217800')).toBeNull();
    expect(normalizeManufacturingOrderScanText(']C10002178005')).toBeNull();
  });
});

const invalidOrderNumbers = [
  '',
  '000217800',
  '00021780050',
  '０００２１７８００５',
  ' 0002178005',
  '0002178005 ',
  '\n0002178005',
  '0002178005\n',
  '00021\n78005',
  '000217800a'
];

describe.each([
  ['manufacturing order', isManufacturingOrderNo, manufacturingOrderNoSchema],
  ['purchase order', isPurchaseOrderNo, purchaseOrderNoSchema]
] as const)('%s strict validation', (_name, isOrderNo, schema) => {
  it('accepts exactly 10 half-width digits and preserves leading zeroes', () => {
    expect(isOrderNo('0002178005')).toBe(true);
    expect(schema.parse('0002178005')).toBe('0002178005');
  });

  it.each(invalidOrderNumbers)('rejects %j without normalization', (value) => {
    expect(isOrderNo(value)).toBe(false);
    expect(() => schema.parse(value)).toThrow();
  });

  it.each([null, undefined, 2178005])('rejects non-string schema input %j', (value) => {
    expect(() => schema.parse(value)).toThrow();
  });
});

describe('manufacturingOrderNoSchema issues', () => {
  const legacy = z.string().length(10).regex(/^\d{10}$/);
  it.each(['', '123', '12345678901', '123456789a', '１２３４５６７８９０', ' 1234567890'])('matches the previous inline schema for %j', (value) => {
    expect(manufacturingOrderNoSchema.safeParse(value).error?.issues).toEqual(legacy.safeParse(value).error?.issues);
  });
});
