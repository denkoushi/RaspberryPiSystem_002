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
