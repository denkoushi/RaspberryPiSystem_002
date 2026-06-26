import { describe, expect, it } from 'vitest';

import {
  applyHundredthsDigitToDimensionValue,
  buildSelfInspectionDimensionTenthsOptions,
  formatDimensionTenthsProvisionalValue,
  resolveSelfInspectionMeasurementValueInputKind
} from '../selfInspectionDimensionValueInput';

import type { InspectionDrawingPoint } from '../types';

function pointFixture(overrides: Partial<InspectionDrawingPoint>): InspectionDrawingPoint {
  return {
    id: 'p1',
    name: '外径',
    markerNo: 1,
    xRatio: 0.1,
    yRatio: 0.2,
    nominalRaw: '100',
    lowerToleranceRaw: '0.10',
    upperToleranceRaw: '0.25',
    testValue: '',
    decimalPlaces: 2,
    ...overrides
  };
}

describe('selfInspectionDimensionValueInput', () => {
  it('uses dimension mode only for known dimension labels', () => {
    expect(resolveSelfInspectionMeasurementValueInputKind(pointFixture({ name: '外径' }))).toBe(
      'dimension_hundredths'
    );
    expect(resolveSelfInspectionMeasurementValueInputKind(pointFixture({ name: '幾何公差' }))).toBe(
      'standard_options'
    );
  });

  it('builds 0.1 base options whose hundredths range intersects tolerance bounds', () => {
    const result = buildSelfInspectionDimensionTenthsOptions(pointFixture({}));
    expect(result.mode).toBe('dropdown_and_free');
    if (result.mode === 'dropdown_and_free') {
      expect(result.stepLabel).toBe('0.1');
      expect(result.options).toEqual(['100.1', '100.2']);
    }
  });

  it('formats provisional tenths without implying a fixed hundredths digit', () => {
    expect(formatDimensionTenthsProvisionalValue('100.1')).toBe('100.1※');
  });

  it('replaces only the second decimal digit', () => {
    expect(applyHundredthsDigitToDimensionValue('100.1', 2)).toBe('100.12');
    expect(applyHundredthsDigitToDimensionValue('100.19', 3)).toBe('100.13');
    expect(applyHundredthsDigitToDimensionValue('100.1※', 9)).toBe('100.19');
  });
});
