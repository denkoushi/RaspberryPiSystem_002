import { describe, expect, it } from 'vitest';
import { resolveToMaxProductNoPerLogicalKey } from '../max-product-no-resolver.js';
import { calculateProductionScheduleDataHash } from '../constants.js';

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

  it('keeps separate unassigned orders with the same part, resource and process', () => {
    const base = { FSEIBAN: '********', FHINCD: 'HMD004884240', FSIGENCD: '500', FKOJUN: '230' };
    const oldOrder = { ...base, ProductNo: '0003729969' };
    const newOrder = { ...base, ProductNo: '0004104427' };
    const rows = resolveToMaxProductNoPerLogicalKey([{ data: oldOrder }, { data: newOrder }]);

    expect(rows.map((row) => row.data.ProductNo)).toEqual(['0003729969', '0004104427']);
    expect(calculateProductionScheduleDataHash(oldOrder)).not.toBe(calculateProductionScheduleDataHash(newOrder));
    expect(calculateProductionScheduleDataHash({ ...oldOrder, FSEIBAN: 'BA1S2320' })).toBe(
      calculateProductionScheduleDataHash({ ...newOrder, FSEIBAN: 'BA1S2320' })
    );
  });
});
