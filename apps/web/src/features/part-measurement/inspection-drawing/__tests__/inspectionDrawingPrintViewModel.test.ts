import { describe, expect, it } from 'vitest';

import {
  buildInspectionDrawingPrintPreviewIdentifier,
  buildInspectionDrawingPrintRecordEntrySlots,
  buildInspectionDrawingPrintViewModel,
  buildRecordPages,
  formatInspectionDrawingPrintIssuedAtDisplay,
  formatInspectionDrawingPrintTolerance,
  InspectionDrawingPrintBuildError
} from '../inspectionDrawingPrintViewModel';
import { templateItemToDrawingPoint } from '../templateItemMappers';

import type { PartMeasurementTemplateDto } from '../../types';

function sampleTemplate(itemCount: number): PartMeasurementTemplateDto {
  const items = Array.from({ length: itemCount }, (_, index) => ({
    id: `pt-${index + 1}`,
    sortOrder: index,
    datumSurface: 'A',
    measurementPoint: 'P',
    measurementLabel: `測定点 ${index + 1}`,
    displayMarker: String(index + 1),
    unit: 'mm',
    allowNegative: false,
    decimalPlaces: 3,
    markerXRatio: '0.35',
    markerYRatio: '0.42',
    nominalValue: '10',
    lowerLimit: '9.95',
    upperLimit: '10.05'
  }));

  return {
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    fhincd: 'DEMO-12345',
    resourceCd: 'R001',
    processGroup: 'cutting',
    templateScope: 'three_key',
    candidateFhinmei: null,
    name: '検査図面プレビュー',
    version: 3,
    isActive: true,
    selfInspectionMode: 'full',
    selfInspectionFixedCount: null,
    selfInspectionSampleSize: null,
    visualTemplateId: 'visual-1',
    visualTemplate: {
      id: 'visual-1',
      name: 'サンプル図面',
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/sample.jpg',
      isActive: true,
      createdAt: '2026-06-14T08:00:00.000Z',
      updatedAt: '2026-06-14T08:00:00.000Z'
    },
    items
  };
}

describe('inspectionDrawingPrintViewModel', () => {
  const issuedAt = new Date('2026-06-14T08:51:00.000Z');

  it('builds metadata, sorted points, and page labels', () => {
    const viewModel = buildInspectionDrawingPrintViewModel({
      template: sampleTemplate(3),
      resourceName: 'R001（FJV50/80）',
      issuedAt
    });

    expect(viewModel.points.map((point) => point.markerNo)).toEqual([1, 2, 3]);
    expect(viewModel.totalPages).toBe(2);
    expect(viewModel.recordPages).toHaveLength(1);
    expect(viewModel.recordPages[0]?.pageLabel).toBe('2/2');
    expect(viewModel.recordPages[0]?.entrySlots.map((slot) => slot.entryLabel)).toEqual([
      '1件目',
      '2件目',
      '3件目',
      '4件目',
      '5件目'
    ]);
    expect(viewModel.metadata.reportUnitKey).toBe('DEMO-12345 / R001');
    expect(viewModel.metadata.previewIdentifier).toBe(
      buildInspectionDrawingPrintPreviewIdentifier(
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        3,
        issuedAt
      )
    );
    expect(viewModel.metadata.issuedAtDisplay).toBe(
      formatInspectionDrawingPrintIssuedAtDisplay(issuedAt)
    );
    expect(viewModel.qrPayloadSummary).toContain('DEMO-12345');
  });

  it('splits record pages when points exceed one page', () => {
    const pages = buildRecordPages(sampleTemplate(15).items.map((item, index) => ({
      id: item.id,
      name: item.measurementLabel,
      markerNo: index + 1,
      xRatio: 0.5,
      yRatio: 0.5,
      nominalRaw: '10',
      lowerToleranceRaw: '-0.05',
      upperToleranceRaw: '0.05',
      testValue: ''
    })));

    expect(pages).toHaveLength(2);
    expect(pages[0]?.slots.filter((slot) => slot.kind === 'point')).toHaveLength(14);
    expect(pages[1]?.slots.filter((slot) => slot.kind === 'point')).toHaveLength(1);
    expect(pages[1]?.slots.filter((slot) => slot.kind === 'empty')).toHaveLength(13);
    expect(pages[0]?.entrySlots).toEqual([{ entryIndex: 0, entryLabel: '1件目' }]);
  });

  it('uses planned quantity for full inspection entry columns', () => {
    const viewModel = buildInspectionDrawingPrintViewModel({
      template: sampleTemplate(3),
      resourceName: 'R001',
      issuedAt,
      plannedQuantity: 3
    });

    expect(viewModel.recordPages).toHaveLength(1);
    expect(viewModel.totalPages).toBe(2);
    expect(viewModel.recordPages[0]?.entrySlots.map((slot) => slot.entryLabel)).toEqual([
      '1件目',
      '2件目',
      '3件目'
    ]);
  });

  it('caps full inspection entry columns at the production maximum', () => {
    const viewModel = buildInspectionDrawingPrintViewModel({
      template: sampleTemplate(1),
      resourceName: 'R001',
      issuedAt,
      plannedQuantity: 2001
    });

    expect(viewModel.recordPages).toHaveLength(400);
    expect(viewModel.recordPages[0]?.entrySlots[0]?.entryLabel).toBe('1件目');
    expect(viewModel.recordPages.at(-1)?.entrySlots.at(-1)?.entryLabel).toBe('2000件目');
  });

  it('continues six fixed inspection entries after five on an additional record page', () => {
    const template = {
      ...sampleTemplate(3),
      selfInspectionMode: 'fixed_count' as const,
      selfInspectionFixedCount: 6,
      selfInspectionSampleSize: 6
    };
    const viewModel = buildInspectionDrawingPrintViewModel({
      template,
      resourceName: 'R001',
      issuedAt
    });

    expect(viewModel.recordPages).toHaveLength(2);
    expect(viewModel.totalPages).toBe(3);
    expect(viewModel.recordPages[0]?.entrySlots.map((slot) => slot.entryLabel)).toEqual([
      '1件目',
      '2件目',
      '3件目',
      '4件目',
      '5件目'
    ]);
    expect(viewModel.recordPages[1]?.entrySlots.map((slot) => slot.entryLabel)).toEqual(['6件目']);
  });

  it('continues fixed inspection entries after five on an additional record page', () => {
    const template = {
      ...sampleTemplate(3),
      selfInspectionMode: 'fixed_count' as const,
      selfInspectionFixedCount: 7,
      selfInspectionSampleSize: 7
    };
    const viewModel = buildInspectionDrawingPrintViewModel({
      template,
      resourceName: 'R001',
      issuedAt
    });

    expect(viewModel.recordPages).toHaveLength(2);
    expect(viewModel.totalPages).toBe(3);
    expect(viewModel.recordPages[0]?.pageLabel).toBe('2/3');
    expect(viewModel.recordPages[0]?.entrySlots.map((slot) => slot.entryLabel)).toEqual([
      '1件目',
      '2件目',
      '3件目',
      '4件目',
      '5件目'
    ]);
    expect(viewModel.recordPages[1]?.pageLabel).toBe('3/3');
    expect(viewModel.recordPages[1]?.entrySlots.map((slot) => slot.entryLabel)).toEqual(['6件目', '7件目']);
  });

  it('labels first and last inspection entry columns', () => {
    expect(
      buildInspectionDrawingPrintRecordEntrySlots({
        selfInspectionMode: 'first_last',
        selfInspectionFixedCount: null,
        selfInspectionSampleSize: null
      })
    ).toEqual([
      { entryIndex: 0, entryLabel: '最初' },
      { entryIndex: 1, entryLabel: '最終' }
    ]);
  });

  it('throws for unsupported templates', () => {
    const template = sampleTemplate(1);
    template.items[0] = { ...template.items[0]!, markerXRatio: null };

    expect(() =>
      buildInspectionDrawingPrintViewModel({
        template,
        resourceName: 'R001',
        issuedAt
      })
    ).toThrow(InspectionDrawingPrintBuildError);
  });

  it('throws when there are no measurement points', () => {
    expect(() =>
      buildInspectionDrawingPrintViewModel({
        template: { ...sampleTemplate(0), items: [] },
        resourceName: 'R001',
        issuedAt
      })
    ).toThrow(InspectionDrawingPrintBuildError);
  });

  it('formats legacy absolute-only tolerance like the editor UI', () => {
    const point = templateItemToDrawingPoint({
      id: 'pt-legacy',
      sortOrder: 0,
      datumSurface: 'A',
      measurementPoint: 'P',
      measurementLabel: '穴径 A',
      displayMarker: '1',
      unit: 'mm',
      allowNegative: false,
      decimalPlaces: 3,
      markerXRatio: '0.35',
      markerYRatio: '0.42',
      nominalValue: null,
      lowerLimit: '9.95',
      upperLimit: '10.05'
    });

    expect(formatInspectionDrawingPrintTolerance(point)).toBe('合格範囲 9.95 - 10.05');
  });
});
