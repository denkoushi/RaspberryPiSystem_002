import { describe, expect, it } from 'vitest';

import {
  buildInspectionDrawingPrintPreviewIdentifier,
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
    const pages = buildRecordPages(sampleTemplate(7).items.map((item, index) => ({
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
    expect(pages[0]?.slots.filter((slot) => slot.kind === 'point')).toHaveLength(6);
    expect(pages[1]?.slots.filter((slot) => slot.kind === 'point')).toHaveLength(1);
    expect(pages[1]?.slots.filter((slot) => slot.kind === 'empty')).toHaveLength(5);
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
