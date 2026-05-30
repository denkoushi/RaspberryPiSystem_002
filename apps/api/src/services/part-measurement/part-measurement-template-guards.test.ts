import { describe, expect, it } from 'vitest';

import { productionPartMeasurementTemplateWhere } from './part-measurement-template-guards.js';
import { PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } from './part-measurement-constants.js';

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
