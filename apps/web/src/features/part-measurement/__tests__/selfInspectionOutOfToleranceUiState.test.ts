import { describe, expect, it } from 'vitest';

import {
  buildSelfInspectionOutOfToleranceAcknowledgements,
  buildSelfInspectionMeasurementStatusOverrides,
  resolveSelfInspectionOutOfToleranceUiState
} from '../selfInspectionOutOfToleranceUiState';

import type { InspectionDrawingPoint } from '../inspection-drawing/types';

function makePoint(overrides: Partial<InspectionDrawingPoint> = {}): InspectionDrawingPoint {
  return {
    id: 'point-1',
    markerNo: 1,
    name: '外径',
    xRatio: 0.5,
    yRatio: 0.5,
    nominalRaw: '10',
    lowerToleranceRaw: '-1',
    upperToleranceRaw: '1',
    testValue: '12',
    valueKind: 'numeric',
    ...overrides
  };
}

describe('selfInspectionOutOfToleranceUiState', () => {
  it('restores acknowledgement only from the persisted acknowledgement timestamp', () => {
    expect(
      buildSelfInspectionOutOfToleranceAcknowledgements([
        {
          templateItemId: 'point-1',
          outOfToleranceAcknowledgedAt: '2026-07-28T00:00:00.000Z'
        },
        { templateItemId: 'point-2', outOfToleranceAcknowledgedAt: null }
      ])
    ).toEqual({ 'point-1': true });
  });

  it('distinguishes unacknowledged and acknowledged numeric NG values', () => {
    expect(resolveSelfInspectionOutOfToleranceUiState(makePoint(), {})).toEqual({
      pointId: 'point-1',
      acknowledged: false,
      label: 'NG・未確認'
    });
    expect(
      resolveSelfInspectionOutOfToleranceUiState(makePoint(), { 'point-1': true })
    ).toEqual({
      pointId: 'point-1',
      acknowledged: true,
      label: 'NG・確認済み'
    });
  });

  it('does not require numeric acknowledgement for judgement FAIL', () => {
    expect(
      resolveSelfInspectionOutOfToleranceUiState(
        makePoint({ valueKind: 'judgement', testValue: 'FAIL' }),
        {}
      )
    ).toBeNull();
  });

  it('builds list status overrides only for numeric NG values', () => {
    expect(
      buildSelfInspectionMeasurementStatusOverrides(
        [
          makePoint(),
          makePoint({ id: 'point-2', markerNo: 2, testValue: '10' }),
          makePoint({
            id: 'point-3',
            markerNo: 3,
            valueKind: 'judgement',
            testValue: 'FAIL'
          })
        ],
        { 'point-1': true }
      )
    ).toEqual({
      'point-1': { label: 'NG・確認済み', tone: 'warning' }
    });
  });
});
