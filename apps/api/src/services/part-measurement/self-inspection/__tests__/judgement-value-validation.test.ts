import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { validateMeasurementPayload } from '../mutation-guards.js';

import type { SelfInspectionTemplate } from '../shared.js';

function templateFor(valueKind: 'NUMERIC' | 'JUDGEMENT'): SelfInspectionTemplate {
  return {
    items: [
      {
        id: 'item-1',
        valueKind,
        allowNegative: false,
        decimalPlaces: 2,
        lowerLimit: valueKind === 'NUMERIC' ? new Prisma.Decimal('9.8') : null,
        upperLimit: valueKind === 'NUMERIC' ? new Prisma.Decimal('10.2') : null,
        depthMode: 'MEASURED'
      }
    ]
  } as unknown as SelfInspectionTemplate;
}

describe('self-inspection judgement value validation', () => {
  it('accepts pipe FAIL without an out-of-tolerance acknowledgement or review', () => {
    const values = validateMeasurementPayload(templateFor('JUDGEMENT'), [
      { templateItemId: 'item-1', judgementResult: 'FAIL' }
    ]);

    expect(values[0]).toMatchObject({
      value: null,
      judgementResult: 'FAIL',
      reviewStatus: 'NOT_REQUIRED',
      outOfToleranceAcknowledgedAt: null
    });
  });

  it('rejects numeric values for pipe judgement and judgement values for numeric points', () => {
    expect(() =>
      validateMeasurementPayload(templateFor('JUDGEMENT'), [
        { templateItemId: 'item-1', value: '10.00', judgementResult: 'PASS' }
      ])
    ).toThrow('管用ネジの測定値はOKまたはNGで入力してください');
    expect(() =>
      validateMeasurementPayload(templateFor('NUMERIC'), [
        { templateItemId: 'item-1', value: '10.00', judgementResult: 'PASS' }
      ])
    ).toThrow('数値測定点にOK/NG判定は入力できません');
  });
});
