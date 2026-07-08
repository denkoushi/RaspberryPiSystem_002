import { describe, expect, it } from 'vitest';

import {
  drawingPointToTemplateItemInput,
  isLegacyAbsoluteOnlyPoint,
  mergeInspectionDrawingPointPatch,
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
    expect(pt.lowerToleranceRaw).toBe('-1');
    expect(pt.upperToleranceRaw).toBe('1');
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
    expect(pt.legacyAbsoluteBounds).toEqual({ lowerLimit: 19.98, upperLimit: 20.02 });

    const saved = drawingPointToTemplateItemInput(pt, 0);
    expect(saved.nominalValue).toBeNull();
    expect(saved.lowerLimit).toBe(19.98);
    expect(saved.upperLimit).toBe(20.02);
  });

  it('normalizes geometric tolerance save bounds to zero and upper value', () => {
    const saved = drawingPointToTemplateItemInput(
      {
        id: 'i1',
        name: '平行度',
        markerNo: 1,
        xRatio: 0.2,
        yRatio: 0.4,
        nominalRaw: '0.005',
        lowerToleranceRaw: '-0.005',
        upperToleranceRaw: '0',
        testValue: '',
        decimalPlaces: 3
      },
      0
    );

    expect(saved.nominalValue).toBe(0.005);
    expect(saved.lowerLimit).toBe(0);
    expect(saved.upperLimit).toBe(0.005);
  });

  it('normalizes configured geometric labels with 0.01 upper value', () => {
    const saved = drawingPointToTemplateItemInput(
      {
        id: 'i1',
        name: '幅',
        markerNo: 1,
        xRatio: 0.2,
        yRatio: 0.4,
        nominalRaw: '0.01',
        lowerToleranceRaw: '-0.01',
        upperToleranceRaw: '0',
        testValue: '',
        decimalPlaces: 3
      },
      0,
      { measurementLabelSettings: [{ label: '幅', toleranceKind: 'geometric' }] }
    );

    expect(saved.nominalValue).toBe(0.01);
    expect(saved.lowerLimit).toBe(0);
    expect(saved.upperLimit).toBe(0.01);
  });

  it('restores supplement fields only from measurementPoint after the label prefix', () => {
    const pt = templateItemToDrawingPoint({
      id: 'i1',
      sortOrder: 0,
      datumSurface: 'A',
      measurementPoint: 'ネジ穴ピッチ M10 正面 2箇所',
      measurementLabel: 'ネジ穴ピッチ',
      displayMarker: '1',
      unit: null,
      allowNegative: true,
      decimalPlaces: 2,
      markerXRatio: '0.2',
      markerYRatio: '0.4',
      nominalValue: '10',
      lowerLimit: '9.9',
      upperLimit: '10.1'
    });

    expect(pt.name).toBe('ネジ穴ピッチ');
    expect(pt.threadNominal).toBe('M10');
    expect(pt.surfaceSide).toBe('正面');
    expect(pt.supplementText).toBe('2箇所');
  });

  it('does not decompose existing labels that already contain supplement text', () => {
    const pt = templateItemToDrawingPoint({
      id: 'i1',
      sortOrder: 0,
      datumSurface: 'A',
      measurementPoint: 'ネジ穴ピッチ M10',
      measurementLabel: 'ネジ穴ピッチ M10',
      displayMarker: '1',
      unit: null,
      allowNegative: true,
      decimalPlaces: 2,
      markerXRatio: '0.2',
      markerYRatio: '0.4',
      nominalValue: '10',
      lowerLimit: '9.9',
      upperLimit: '10.1'
    });

    expect(pt.name).toBe('ネジ穴ピッチ M10');
    expect(pt.threadNominal).toBe('');
    expect(pt.surfaceSide).toBe('');
    expect(pt.supplementText).toBe('');
  });

  it('saves label and supplement into separate measurement fields', () => {
    const saved = drawingPointToTemplateItemInput(
      {
        id: 'i1',
        name: 'ネジ穴ピッチ',
        threadNominal: 'M10',
        surfaceSide: '両面',
        supplementText: '2箇所',
        markerNo: 1,
        xRatio: 0.2,
        yRatio: 0.4,
        nominalRaw: '10',
        lowerToleranceRaw: '-0.1',
        upperToleranceRaw: '+0.1',
        testValue: '',
        decimalPlaces: 3
      },
      0
    );

    expect(saved.measurementLabel).toBe('ネジ穴ピッチ');
    expect(saved.measurementPoint).toBe('ネジ穴ピッチ M10 両面 2箇所');
  });

  it('keeps legacy bounds when only name changes', () => {
    const pt = templateItemToDrawingPoint({
      id: 'i1',
      sortOrder: 0,
      datumSurface: 'A',
      measurementPoint: '外径',
      measurementLabel: '外径',
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
    const updated = mergeInspectionDrawingPointPatch(pt, { name: '内径' });
    const saved = drawingPointToTemplateItemInput(updated, 0);
    expect(saved.lowerLimit).toBe(19.98);
    expect(saved.upperLimit).toBe(20.02);
  });

  it('detects legacy absolute-only row for display', () => {
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
      lowerLimit: '100.95',
      upperLimit: '101.05'
    });
    expect(isLegacyAbsoluteOnlyPoint(pt)).toBe(true);
    expect(pt.legacyAbsoluteBounds).toEqual({ lowerLimit: 100.95, upperLimit: 101.05 });
  });

  it('seeds both offsets when migrating legacy with one-sided edit', () => {
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
      lowerLimit: '100.95',
      upperLimit: '101.05'
    });
    const migrated = mergeInspectionDrawingPointPatch(pt, { lowerToleranceRaw: '-0.05' });
    expect(migrated.legacyAbsoluteBounds).toBeUndefined();
    expect(migrated.lowerToleranceRaw).toBe('-0.05');
    expect(migrated.upperToleranceRaw).toBe('0.05');

    const saved = drawingPointToTemplateItemInput(
      { ...migrated, nominalRaw: '101' },
      0
    );
    expect(saved.lowerLimit).toBe(100.95);
    expect(saved.upperLimit).toBe(101.05);
  });
});
