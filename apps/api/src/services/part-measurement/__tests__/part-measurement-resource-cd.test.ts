import { describe, expect, it } from 'vitest';

import { PART_MEASUREMENT_LEGACY_RESOURCE_CD } from '../part-measurement-constants.js';
import { normalizePartMeasurementResourceCd } from '../part-measurement-resource-cd.js';

describe('normalizePartMeasurementResourceCd', () => {
  it('trims the resource code while preserving case', () => {
    expect(normalizePartMeasurementResourceCd(' ab-01 ')).toBe('ab-01');
  });

  it.each(['', ' \t\n '])('uses the legacy code for empty input %s', (raw) => {
    expect(normalizePartMeasurementResourceCd(raw)).toBe(PART_MEASUREMENT_LEGACY_RESOURCE_CD);
  });
});
