import { describe, expect, it } from 'vitest';

import { normalizeManufacturingOrderScanText } from './manufacturingOrderScan';

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
