import { describe, expect, it } from 'vitest';

import {
  buildSelfInspectionMeasurementValueOptions,
  SELF_INSPECTION_MEASUREMENT_VALUE_OPTION_MAX
} from '../selfInspectionMeasurementValueOptions';

import type { InspectionDrawingPoint } from '../types';

function pointFixture(overrides: Partial<InspectionDrawingPoint>): InspectionDrawingPoint {
  return {
    id: 'p1',
    name: '外径',
    markerNo: 1,
    xRatio: 0.1,
    yRatio: 0.2,
    nominalRaw: '101',
    lowerToleranceRaw: '-0.05',
    upperToleranceRaw: '0.05',
    testValue: '',
    decimalPlaces: 2,
    ...overrides
  };
}

describe('selfInspectionMeasurementValueOptions', () => {
  it('builds 0.01 step options for ±0.05', () => {
    const result = buildSelfInspectionMeasurementValueOptions(pointFixture({}));
    expect(result.mode).toBe('dropdown_and_free');
    if (result.mode === 'dropdown_and_free') {
      expect(result.options[0]).toBe('100.95');
      expect(result.options[result.options.length - 1]).toBe('101.05');
      expect(result.options).toContain('101.00');
      expect(result.options.length).toBe(11);
    }
  });

  it('builds 0.1 step options for ±0.1', () => {
    const result = buildSelfInspectionMeasurementValueOptions(
      pointFixture({
        nominalRaw: '10',
        lowerToleranceRaw: '-0.1',
        upperToleranceRaw: '0.1'
      })
    );
    expect(result.mode).toBe('dropdown_and_free');
    if (result.mode === 'dropdown_and_free') {
      expect(result.options).toEqual(['9.9', '10.0', '10.1']);
    }
  });

  it('does not include step-aligned values outside absolute bounds', () => {
    const result = buildSelfInspectionMeasurementValueOptions(
      pointFixture({
        nominalRaw: '',
        lowerToleranceRaw: '',
        upperToleranceRaw: '',
        legacyAbsoluteBounds: { lowerLimit: 9.95, upperLimit: 10.05 },
        decimalPlaces: 1
      })
    );
    expect(result.mode).toBe('dropdown_and_free');
    if (result.mode === 'dropdown_and_free') {
      expect(result.options).toEqual(['10.0']);
      expect(result.options).not.toContain('10.1');
      expect(result.options).not.toContain('9.9');
    }
  });

  it('falls back to free_only when option count exceeds max', () => {
    const result = buildSelfInspectionMeasurementValueOptions(
      pointFixture({
        nominalRaw: '0',
        lowerToleranceRaw: '-100',
        upperToleranceRaw: '100'
      })
    );
    expect(result.mode).toBe('free_only');
    expect(SELF_INSPECTION_MEASUREMENT_VALUE_OPTION_MAX).toBe(200);
  });
});
