import { describe, expect, it } from 'vitest';

import { PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } from './part-measurement-constants.js';
import {
  sheetUsesInspectionDrawingEvaluationUi,
  sheetUsesProductionInspectionDrawingUi,
  templateSupportsInspectionDrawing
} from './part-measurement-inspection-drawing-policy.js';

describe('part-measurement-inspection-drawing-policy', () => {
  const drawingTemplate = {
    fhincd: 'PROD-1',
    visualTemplate: { drawingImageRelativePath: '/api/storage/x.png' },
    items: [
      {
        markerXRatio: '0.1',
        markerYRatio: '0.2',
        lowerLimit: '0',
        upperLimit: '1'
      }
    ]
  };

  it('allows production sheet with quantity 1 and full markers', () => {
    expect(
      sheetUsesProductionInspectionDrawingUi({
        quantity: 1,
        template: drawingTemplate
      })
    ).toBe(true);
  });

  it('rejects production sheet with quantity>1', () => {
    expect(
      sheetUsesProductionInspectionDrawingUi({
        quantity: 2,
        template: drawingTemplate
      })
    ).toBe(false);
  });

  it('keeps quantity null out of production drawing ui until create sets it explicitly', () => {
    expect(
      sheetUsesProductionInspectionDrawingUi({
        quantity: null,
        template: drawingTemplate
      })
    ).toBe(false);
  });

  it('detects evaluation bucket sheets separately', () => {
    expect(
      sheetUsesInspectionDrawingEvaluationUi({
        quantity: 1,
        template: { fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD }
      })
    ).toBe(true);
    expect(
      sheetUsesProductionInspectionDrawingUi({
        quantity: 1,
        template: {
          ...drawingTemplate,
          fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD
        }
      })
    ).toBe(false);
  });

  it('requires drawing path and markers on all items', () => {
    expect(
      templateSupportsInspectionDrawing({
        visualTemplate: null,
        items: drawingTemplate.items
      })
    ).toBe(false);
    expect(templateSupportsInspectionDrawing(drawingTemplate)).toBe(true);
  });
});
