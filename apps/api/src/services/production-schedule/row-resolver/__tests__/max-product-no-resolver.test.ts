import { describe, expect, it } from 'vitest';
import { resolveToMaxProductNoPerLogicalKey } from '../max-product-no-resolver.js';

describe('resolveToMaxProductNoPerLogicalKey', () => {
  it('keeps the row with max ProductNo for the same logical key', () => {
    const rows = [
      {
        data: {
          ProductNo: '1000000001',
          FSEIBAN: 'BA1S2320',
          FHINCD: 'P001',
          FSIGENCD: 'R01',
          FKOJUN: '10',
        },
        occurredAt: new Date('2026-02-10T00:00:00Z'),
      },
      {
        data: {
          ProductNo: '1000000009',
          FSEIBAN: 'BA1S2320',
          FHINCD: 'P001',
          FSIGENCD: 'R01',
          FKOJUN: '10',
        },
        occurredAt: new Date('2026-02-10T01:00:00Z'),
      },
    ];

    const resolved = resolveToMaxProductNoPerLogicalKey(rows);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.data.ProductNo).toBe('1000000009');
  });

  it('does not collapse rows with different logical keys', () => {
    const rows = [
      {
        data: {
          ProductNo: '1000000001',
          FSEIBAN: 'BA1S2320',
          FHINCD: 'P001',
          FSIGENCD: 'R01',
          FKOJUN: '10',
        },
      },
      {
        data: {
          ProductNo: '1000000009',
          FSEIBAN: 'BA1S2320',
          FHINCD: 'P002',
          FSIGENCD: 'R01',
          FKOJUN: '10',
        },
      },
    ];

    const resolved = resolveToMaxProductNoPerLogicalKey(rows);
    expect(resolved).toHaveLength(2);
  });
});
