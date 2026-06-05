import { describe, expect, it } from 'vitest';

import {
  clampInspectionDrawingRatio,
  INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO,
  nudgeInspectionDrawingPoint
} from '../inspectionDrawingPointPosition';
import { drawingPointToTemplateItemInput } from '../markerNumbering';

import type { InspectionDrawingPoint } from '../types';

function basePoint(overrides: Partial<InspectionDrawingPoint> = {}): InspectionDrawingPoint {
  return {
    id: 'pt-1',
    name: '穴径',
    markerNo: 1,
    xRatio: 0.5,
    yRatio: 0.5,
    nominalRaw: '10',
    upperToleranceRaw: '0.05',
    lowerToleranceRaw: '-0.05',
    testValue: '',
    decimalPlaces: 3,
    ...overrides
  };
}

describe('clampInspectionDrawingRatio', () => {
  it('clamps finite numbers to 0..1', () => {
    expect(clampInspectionDrawingRatio(0.5)).toBe(0.5);
    expect(clampInspectionDrawingRatio(-0.1)).toBe(0);
    expect(clampInspectionDrawingRatio(1.2)).toBe(1);
  });

  it('maps NaN / Infinity / non-number to 0', () => {
    expect(clampInspectionDrawingRatio(Number.NaN)).toBe(0);
    expect(clampInspectionDrawingRatio(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampInspectionDrawingRatio(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(clampInspectionDrawingRatio('0.5')).toBe(0);
    expect(clampInspectionDrawingRatio(null)).toBe(0);
  });
});

describe('nudgeInspectionDrawingPoint', () => {
  const step = INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO;

  it('moves in each direction without mutating the source point', () => {
    const source = basePoint({ xRatio: 0.5, yRatio: 0.5 });

    expect(nudgeInspectionDrawingPoint(source, 'right').xRatio).toBeCloseTo(0.5 + step);
    expect(nudgeInspectionDrawingPoint(source, 'left').xRatio).toBeCloseTo(0.5 - step);
    expect(nudgeInspectionDrawingPoint(source, 'down').yRatio).toBeCloseTo(0.5 + step);
    expect(nudgeInspectionDrawingPoint(source, 'up').yRatio).toBeCloseTo(0.5 - step);

    expect(source.xRatio).toBe(0.5);
    expect(source.yRatio).toBe(0.5);
  });

  it('preserves fields other than xRatio and yRatio', () => {
    const source = basePoint({ name: '外径', markerNo: 3, nominalRaw: '8' });
    const next = nudgeInspectionDrawingPoint(source, 'right');

    expect(next.name).toBe('外径');
    expect(next.markerNo).toBe(3);
    expect(next.nominalRaw).toBe('8');
    expect(next.id).toBe(source.id);
  });

  it('clamps at image edges', () => {
    expect(nudgeInspectionDrawingPoint(basePoint({ xRatio: 0 }), 'left').xRatio).toBe(0);
    expect(nudgeInspectionDrawingPoint(basePoint({ xRatio: 1 }), 'right').xRatio).toBe(1);
    expect(nudgeInspectionDrawingPoint(basePoint({ yRatio: 0 }), 'up').yRatio).toBe(0);
    expect(nudgeInspectionDrawingPoint(basePoint({ yRatio: 1 }), 'down').yRatio).toBe(1);
  });

  it('maps nudged coordinates into drawingPointToTemplateItemInput payload', () => {
    const nudged = nudgeInspectionDrawingPoint(basePoint({ xRatio: 0.25, yRatio: 0.75 }), 'right');
    const saved = drawingPointToTemplateItemInput(nudged, 0);

    expect(saved.markerXRatio).toBeCloseTo(0.25 + step);
    expect(saved.markerYRatio).toBe(0.75);
  });
});
