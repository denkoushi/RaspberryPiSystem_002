import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { resolveHeatstripCellTone } from '../self-inspection-machine-board-heatstrip.js';

describe('resolveHeatstripCellTone', () => {
  const item = {
    lowerLimit: new Prisma.Decimal('9.0'),
    upperLimit: new Prisma.Decimal('11.0'),
    nominalValue: new Prisma.Decimal('10.0'),
    decimalPlaces: 2,
  };

  it('returns missing for null value', () => {
    expect(resolveHeatstripCellTone(null, item)).toEqual({ tone: 'missing', displayValue: null });
  });

  it('returns neutral when tolerance is incomplete', () => {
    expect(
      resolveHeatstripCellTone(new Prisma.Decimal('10.0'), {
        ...item,
        lowerLimit: null,
      })
    ).toEqual({ tone: 'neutral', displayValue: '10' });
  });

  it('returns out_of_tolerance when value exceeds bounds', () => {
    expect(resolveHeatstripCellTone(new Prisma.Decimal('12.0'), item).tone).toBe('out_of_tolerance');
  });

  it('returns center near nominal', () => {
    expect(resolveHeatstripCellTone(new Prisma.Decimal('10.0'), item).tone).toBe('center');
  });

  it('returns edge near tolerance boundary', () => {
    expect(resolveHeatstripCellTone(new Prisma.Decimal('9.1'), item).tone).toBe('edge');
  });
});
