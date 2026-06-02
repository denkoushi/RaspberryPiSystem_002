import { describe, expect, it } from 'vitest';

import {
  drawingPointToTemplateItemInput,
  nextAvailableMarkerNo,
  parseDisplayMarkerAsMarkerNo,
  templateItemToDrawingPoint
} from '../markerNumbering';

describe('markerNumbering', () => {
  it('reuses smallest missing markerNo after delete', () => {
    expect(nextAvailableMarkerNo([{ markerNo: 1 }, { markerNo: 3 }])).toBe(2);
    expect(nextAvailableMarkerNo([{ markerNo: 2 }, { markerNo: 3 }])).toBe(1);
  });

  it('parses numeric displayMarker', () => {
    expect(parseDisplayMarkerAsMarkerNo('12')).toBe(12);
    expect(parseDisplayMarkerAsMarkerNo('abc')).toBeNull();
  });

  it('falls back to sortOrder+1 for non-numeric displayMarker', () => {
    const pt = templateItemToDrawingPoint({
      id: 'i1',
      sortOrder: 4,
      datumSurface: 'A',
      measurementPoint: 'P',
      measurementLabel: 'L',
      displayMarker: '丸①',
      unit: null,
      allowNegative: true,
      decimalPlaces: 2,
      markerXRatio: '0.1',
      markerYRatio: '0.2',
      nominalValue: '10',
      lowerLimit: '9',
      upperLimit: '11'
    });
    expect(pt.markerNo).toBe(5);
  });

  it('preserves absolute limits when nominalValue is null on load and save without edits', () => {
    const pt = templateItemToDrawingPoint({
      id: 'i1',
      sortOrder: 0,
      datumSurface: 'A',
      measurementPoint: 'P',
      measurementLabel: 'L',
      displayMarker: '1',
      unit: null,
      allowNegative: true,
      decimalPlaces: 2,
      markerXRatio: '0.2',
      markerYRatio: '0.4',
      nominalValue: null,
      lowerLimit: '19.98',
      upperLimit: '20.02'
    });
    expect(pt.nominalRaw).toBe('');
    expect(pt.lowerToleranceRaw).toBe('');
    expect(pt.legacyAbsoluteBounds).toEqual({ lowerLimit: 19.98, upperLimit: 20.02 });

    const saved = drawingPointToTemplateItemInput(pt, 0);
    expect(saved.nominalValue).toBeNull();
    expect(saved.lowerLimit).toBe(19.98);
    expect(saved.upperLimit).toBe(20.02);
  });
});
