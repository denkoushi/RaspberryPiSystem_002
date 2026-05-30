import { describe, expect, it } from 'vitest';

import {
  getInspectionDrawingEvaluationEditAccess,
  PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD
} from './evaluationSheetAccess';

import type { PartMeasurementSheetDto } from '../types';

function sheet(overrides: Partial<PartMeasurementSheetDto>): PartMeasurementSheetDto {
  return {
    id: 's1',
    status: 'DRAFT',
    productNo: 'PN',
    fseiban: 'FS',
    fhincd: 'FH',
    fhinmei: '名',
    resourceCdSnapshot: 'R',
    processGroupSnapshot: 'cutting',
    quantity: 1,
    results: [],
    template: null,
    ...overrides
  } as PartMeasurementSheetDto;
}

describe('getInspectionDrawingEvaluationEditAccess', () => {
  it('allows eval-bucket template with quantity 1', () => {
    const access = getInspectionDrawingEvaluationEditAccess(
      sheet({
        template: {
          fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD
        } as PartMeasurementSheetDto['template']
      })
    );
    expect(access.allowed).toBe(true);
  });

  it('rejects production fhincd template', () => {
    const access = getInspectionDrawingEvaluationEditAccess(
      sheet({
        template: { fhincd: 'REAL-PART' } as PartMeasurementSheetDto['template']
      })
    );
    expect(access.allowed).toBe(false);
    expect(access.reason).toMatch(/評価用テンプレート/);
  });

  it('rejects quantity greater than 1', () => {
    const access = getInspectionDrawingEvaluationEditAccess(
      sheet({
        quantity: 5,
        template: {
          fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD
        } as PartMeasurementSheetDto['template']
      })
    );
    expect(access.allowed).toBe(false);
    expect(access.reason).toMatch(/数量/);
  });
});
