import { describe, expect, it } from 'vitest';

import {
  buildMeasurementLabelSelectOptions,
  INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS
} from '../inspectionDrawingMeasurementLabelOptions';

describe('inspectionDrawingMeasurementLabelOptions', () => {
  it('deduplicates fixed candidates', () => {
    const unique = new Set(INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS);
    expect(unique.size).toBe(INSPECTION_DRAWING_MEASUREMENT_LABEL_OPTIONS.length);
  });

  it('prepends legacy value when current is outside fixed list', () => {
    const options = buildMeasurementLabelSelectOptions('カスタム寸法');
    expect(options[0]).toEqual({ value: 'カスタム寸法', label: 'カスタム寸法（既存）' });
  });

  it('includes placeholder for empty new point', () => {
    const options = buildMeasurementLabelSelectOptions('');
    expect(options[0]).toEqual({ value: '', label: '選択してください' });
  });
});
