import { describe, expect, it } from 'vitest';

import {
  clearInspectionDrawingCalloutTip,
  inspectionDrawingPointHasCalloutTip,
  setInspectionDrawingCalloutTip
} from '../inspectionDrawingCalloutTip';
import { createInspectionDrawingPoint, drawingPointToTemplateItemInput, templateItemToDrawingPoint } from '../markerNumbering';

import type { PartMeasurementTemplateItemDto } from '../../types';

describe('inspectionDrawingCalloutTip', () => {
  it('detects valid tip pair', () => {
    expect(inspectionDrawingPointHasCalloutTip({ calloutTipXRatio: 0.2, calloutTipYRatio: 0.3 })).toBe(true);
    expect(inspectionDrawingPointHasCalloutTip({ calloutTipXRatio: null, calloutTipYRatio: 0.3 })).toBe(false);
    expect(inspectionDrawingPointHasCalloutTip({})).toBe(false);
  });

  it('clamps tip ratios', () => {
    expect(setInspectionDrawingCalloutTip(-0.1, 1.2)).toEqual({
      calloutTipXRatio: 0,
      calloutTipYRatio: 1
    });
    expect(clearInspectionDrawingCalloutTip()).toEqual({
      calloutTipXRatio: null,
      calloutTipYRatio: null
    });
  });
});

describe('markerNumbering callout tip round-trip', () => {
  it('maps tip fields through template item DTO', () => {
    const point = {
      ...createInspectionDrawingPoint(0.4, 0.5, 1),
      name: '穴径',
      nominalRaw: '12',
      upperToleranceRaw: '0.1',
      lowerToleranceRaw: '-0.1',
      calloutTipXRatio: 0.22,
      calloutTipYRatio: 0.33
    };
    const input = drawingPointToTemplateItemInput(point, 0);
    expect(input.calloutTipXRatio).toBe(0.22);
    expect(input.calloutTipYRatio).toBe(0.33);

    const dto: PartMeasurementTemplateItemDto = {
      id: 'item-1',
      sortOrder: 0,
      datumSurface: '—',
      measurementPoint: '穴径',
      measurementLabel: '穴径',
      displayMarker: '1',
      unit: null,
      allowNegative: true,
      decimalPlaces: 3,
      markerXRatio: '0.4',
      markerYRatio: '0.5',
      calloutTipXRatio: '0.22',
      calloutTipYRatio: '0.33',
      nominalValue: '12',
      lowerLimit: '11.9',
      upperLimit: '12.1',
      depthMode: 'measured'
    };
    const restored = templateItemToDrawingPoint(dto);
    expect(restored.calloutTipXRatio).toBe(0.22);
    expect(restored.calloutTipYRatio).toBe(0.33);
  });

  it('keeps null tip when absent', () => {
    const point = createInspectionDrawingPoint(0.1, 0.2, 2);
    const input = drawingPointToTemplateItemInput(
      {
        ...point,
        name: '幅',
        nominalRaw: '10',
        upperToleranceRaw: '0',
        lowerToleranceRaw: '0'
      },
      1
    );
    expect(input.calloutTipXRatio).toBeNull();
    expect(input.calloutTipYRatio).toBeNull();
  });
});
