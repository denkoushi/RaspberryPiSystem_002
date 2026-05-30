import { describe, expect, it } from 'vitest';

import {
  getInspectionDrawingEvaluationEditAccess,
  PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD
} from './evaluationSheetAccess';

import type { PartMeasurementSheetDto, PartMeasurementTemplateDto } from '../types';

function drawingEvalTemplate(
  overrides?: Partial<PartMeasurementTemplateDto>
): PartMeasurementTemplateDto {
  return {
    id: 'tpl-eval',
    fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD,
    resourceCd: 'eval-res',
    processGroup: null,
    templateScope: 'three_key',
    candidateFhinmei: null,
    name: '評価用',
    version: 1,
    isActive: true,
    visualTemplateId: 'vt-1',
    visualTemplate: {
      id: 'vt-1',
      name: '図',
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/eval.png',
      isActive: true,
      createdAt: '',
      updatedAt: ''
    },
    items: [
      {
        id: 'item-1',
        sortOrder: 0,
        datumSurface: 'A',
        measurementPoint: 'P',
        measurementLabel: 'L',
        displayMarker: null,
        unit: null,
        allowNegative: true,
        decimalPlaces: 3,
        markerXRatio: '0.1',
        markerYRatio: '0.2',
        nominalValue: '0',
        lowerLimit: '0',
        upperLimit: '1'
      }
    ],
    ...overrides
  };
}

function sheet(overrides: Partial<PartMeasurementSheetDto>): PartMeasurementSheetDto {
  return {
    id: 's1',
    sessionId: 'sess',
    status: 'DRAFT',
    productNo: 'PN',
    fseiban: 'FS',
    fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD,
    fhinmei: '名',
    machineName: null,
    resourceCdSnapshot: 'R',
    processGroupSnapshot: 'cutting',
    employeeId: null,
    employeeNameSnapshot: null,
    createdByEmployeeId: null,
    createdByEmployeeNameSnapshot: null,
    finalizedByEmployeeId: null,
    finalizedByEmployeeNameSnapshot: null,
    quantity: 1,
    scannedBarcodeRaw: null,
    templateId: 'tpl-eval',
    clientDeviceId: null,
    clientDeviceName: null,
    editLockClientDeviceId: null,
    editLockExpiresAt: null,
    editLockClientDeviceName: null,
    cancelledAt: null,
    cancelReason: null,
    invalidatedAt: null,
    invalidatedReason: null,
    finalizedAt: null,
    createdAt: '',
    updatedAt: '',
    results: [],
    template: drawingEvalTemplate(),
    ...overrides
  } as PartMeasurementSheetDto;
}

describe('getInspectionDrawingEvaluationEditAccess', () => {
  it('allows eval-bucket template with quantity 1 and full drawing markers', () => {
    const access = getInspectionDrawingEvaluationEditAccess(sheet({}));
    expect(access.allowed).toBe(true);
  });

  it('rejects production fhincd template', () => {
    const access = getInspectionDrawingEvaluationEditAccess(
      sheet({
        fhincd: 'REAL-PART',
        template: drawingEvalTemplate({ fhincd: 'REAL-PART' })
      })
    );
    expect(access.allowed).toBe(false);
    expect(access.reason).toMatch(/評価専用/);
  });

  it('rejects quantity greater than 1', () => {
    const access = getInspectionDrawingEvaluationEditAccess(
      sheet({
        quantity: 5,
        template: drawingEvalTemplate()
      })
    );
    expect(access.allowed).toBe(false);
    expect(access.reason).toMatch(/数量/);
  });

  it('rejects eval template without drawing support', () => {
    const access = getInspectionDrawingEvaluationEditAccess(
      sheet({
        template: drawingEvalTemplate({
          visualTemplate: null,
          items: [
            {
              id: 'item-1',
              sortOrder: 0,
              datumSurface: 'A',
              measurementPoint: 'P',
              measurementLabel: 'L',
              displayMarker: null,
              unit: null,
              allowNegative: true,
              decimalPlaces: 3,
              markerXRatio: null,
              markerYRatio: null,
              nominalValue: null,
              lowerLimit: null,
              upperLimit: null
            }
          ]
        })
      })
    );
    expect(access.allowed).toBe(false);
    expect(access.reason).toMatch(/図面中心UI/);
  });
});
