import { describe, expect, it } from 'vitest';

import {
  assertProductionPartMeasurementSheet,
  productionPartMeasurementSheetWhere,
  productionPartMeasurementTemplateWhere
} from './part-measurement-template-guards.js';
import { PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } from './part-measurement-constants.js';
import { ApiError } from '../../lib/errors.js';

describe('productionPartMeasurementTemplateWhere', () => {
  it('keeps fhincd equals and adds eval-bucket exclusion via AND', () => {
    const merged = productionPartMeasurementTemplateWhere({
      isActive: true,
      templateScope: 'THREE_KEY',
      fhincd: { equals: 'ABC-123', mode: 'insensitive' }
    });

    expect(merged.AND).toHaveLength(2);
    expect(merged.AND?.[0]).toMatchObject({
      fhincd: { equals: 'ABC-123', mode: 'insensitive' }
    });
    expect(merged.AND?.[1]).toEqual({
      fhincd: { not: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD }
    });
  });
});

describe('productionPartMeasurementSheetWhere', () => {
  it('excludes evaluation template sheets from draft/finalized lists', () => {
    const merged = productionPartMeasurementSheetWhere({ status: 'DRAFT' });
    expect(merged.AND).toHaveLength(2);
    expect(merged.AND?.[0]).toEqual({ status: 'DRAFT' });
    expect(merged.AND?.[1]).toEqual({
      template: { fhincd: { not: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } }
    });
  });
});

describe('assertProductionPartMeasurementSheet', () => {
  it('rejects evaluation template sheets on production APIs', () => {
    expect(() =>
      assertProductionPartMeasurementSheet({
        template: { fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD }
      })
    ).toThrow(ApiError);
    expect(() =>
      assertProductionPartMeasurementSheet({
        template: { fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD }
      })
    ).toThrow(/通常の記録表 API/);
  });

  it('allows production template sheets', () => {
    expect(() =>
      assertProductionPartMeasurementSheet({ template: { fhincd: 'ABC-123' } })
    ).not.toThrow();
  });
});
