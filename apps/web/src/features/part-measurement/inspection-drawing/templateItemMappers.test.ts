import { describe, expect, it } from 'vitest';

import { templateItemHasInspectionMarker, templateSupportsInspectionDrawing } from './templateItemMappers';

import type { PartMeasurementTemplateItemDto } from '../types';

const baseItem = (): PartMeasurementTemplateItemDto => ({
  id: '1',
  sortOrder: 0,
  datumSurface: 'A',
  measurementPoint: 'p1',
  measurementLabel: '外径',
  displayMarker: '1',
  unit: 'mm',
  allowNegative: true,
  decimalPlaces: 3,
  markerXRatio: null,
  markerYRatio: null,
  nominalValue: null,
  lowerLimit: null,
  upperLimit: null
});

describe('templateItemHasInspectionMarker', () => {
  it('true when coords and limits present', () => {
    const item = {
      ...baseItem(),
      markerXRatio: '0.5',
      markerYRatio: '0.5',
      lowerLimit: '19.98',
      upperLimit: '20.02'
    };
    expect(templateItemHasInspectionMarker(item)).toBe(true);
  });

  it('false when marker missing', () => {
    expect(templateItemHasInspectionMarker(baseItem())).toBe(false);
  });
});

describe('templateSupportsInspectionDrawing', () => {
  it('requires drawing path and all items marked', () => {
    const item = {
      ...baseItem(),
      markerXRatio: '0.1',
      markerYRatio: '0.2',
      lowerLimit: '0',
      upperLimit: '1'
    };
    expect(templateSupportsInspectionDrawing([item], '/api/storage/part-measurement-drawings/x.png')).toBe(
      true
    );
    expect(templateSupportsInspectionDrawing([item], null)).toBe(false);
    expect(templateSupportsInspectionDrawing([baseItem(), item], '/x.png')).toBe(false);
  });
});
