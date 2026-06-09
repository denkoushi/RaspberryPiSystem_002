import { describe, expect, it } from 'vitest';

import { makeSelfInspectionTemplateItemForTest } from '../../__tests__/selfInspectionSessionTestFixtures';
import {
  MEASUREMENT_POINT_INPUT_STATUS_LABEL,
  resolveMeasurementPointInputStatus
} from '../measurementPointInputStatus';
import { templateItemToDrawingPoint } from '../templateItemMappers';

import type { InspectionDrawingPoint } from '../types';

function makePoint(overrides: Partial<InspectionDrawingPoint> & { id: string }): InspectionDrawingPoint {
  return {
    id: overrides.id,
    markerNo: overrides.markerNo ?? 1,
    name: overrides.name ?? '外径',
    xRatio: 0.5,
    yRatio: 0.5,
    nominalRaw: overrides.nominalRaw ?? '10',
    lowerToleranceRaw: overrides.lowerToleranceRaw ?? '-0.1',
    upperToleranceRaw: overrides.upperToleranceRaw ?? '0.1',
    testValue: overrides.testValue ?? ''
  };
}

describe('resolveMeasurementPointInputStatus', () => {
  it('returns empty for blank testValue', () => {
    expect(resolveMeasurementPointInputStatus(makePoint({ id: 'p1', testValue: '' }))).toBe('empty');
  });

  it('returns ok for in-tolerance value', () => {
    expect(resolveMeasurementPointInputStatus(makePoint({ id: 'p1', testValue: '10' }))).toBe('ok');
  });

  it('returns ng for out-of-tolerance value', () => {
    expect(resolveMeasurementPointInputStatus(makePoint({ id: 'p1', testValue: '9' }))).toBe('ng');
  });

  it('returns invalid for non-numeric value', () => {
    expect(resolveMeasurementPointInputStatus(makePoint({ id: 'p1', testValue: 'abc' }))).toBe('invalid');
  });

  it('returns tolerance_error when bounds are missing', () => {
    const item = makeSelfInspectionTemplateItemForTest({
      id: 'p1',
      sortOrder: 0,
      nominalValue: null,
      lowerLimit: null,
      upperLimit: null
    });
    const point = templateItemToDrawingPoint(item, '10');
    expect(resolveMeasurementPointInputStatus(point)).toBe('tolerance_error');
  });

  it('labels cover all statuses', () => {
    const statuses = ['empty', 'ok', 'ng', 'invalid', 'tolerance_error'] as const;
    for (const status of statuses) {
      expect(MEASUREMENT_POINT_INPUT_STATUS_LABEL[status]).toBeTruthy();
    }
  });
});
