import { describe, expect, it } from 'vitest';

import { normalizeManufacturingOrderScanText } from './manufacturingOrderScan';

describe('normalizeManufacturingOrderScanText', () => {
  it('trims scanner framing characters without changing the manufacturing order value', () => {
    expect(normalizeManufacturingOrderScanText('\r\n0002178005　A\n')).toBe('0002178005 A');
  });
});
