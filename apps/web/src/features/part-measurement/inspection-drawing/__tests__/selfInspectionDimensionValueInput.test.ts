import { describe, expect, it } from 'vitest';

import {
  applyHundredthsDigitToDimensionValue,
  applyThousandthsDigitToDimensionValue,
  buildSelfInspectionDimensionTenthsOptions,
  formatDimensionTenthsProvisionalValue,
  resolveSelfInspectionDimensionKeypadDigitCount,
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

  it('asks for thousandths only when the nominal or tolerance is written to three decimals', () => {
    expect(resolveSelfInspectionDimensionKeypadDigitCount(pointFixture({}))).toBe(1);
    expect(
      resolveSelfInspectionDimensionKeypadDigitCount(
        pointFixture({ lowerToleranceRaw: '-0.005', upperToleranceRaw: '+0.005' })
      )
    ).toBe(2);
    expect(resolveSelfInspectionDimensionKeypadDigitCount(pointFixture({ decimalPlaces: 3 }))).toBe(1);
  });

  it('builds 0.1 base options that cover a thousandths tolerance below the nominal', () => {
    const result = buildSelfInspectionDimensionTenthsOptions(
      pointFixture({ lowerToleranceRaw: '-0.005', upperToleranceRaw: '0.005' })
    );
    expect(result).toEqual({ mode: 'dropdown_and_free', options: ['99.9', '100.0'], stepLabel: '0.1' });
  });

  it('appends the thousandths digit after the hundredths digit', () => {
    expect(applyThousandthsDigitToDimensionValue('100.0', 3, 4)).toBe('100.034');
    expect(applyThousandthsDigitToDimensionValue('99.987', 9, 5)).toBe('99.995');
    expect(applyThousandthsDigitToDimensionValue('abc', 1, 2)).toBeNull();
    expect(applyThousandthsDigitToDimensionValue('100.0', 1, 10)).toBeNull();
  });
});
