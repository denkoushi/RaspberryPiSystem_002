import { describe, expect, it } from 'vitest';

import { PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD } from './evaluationSheetAccess';
import {
  getInspectionDrawingEditAccess,
  productionTemplateEligibleForInspectionDrawingUi,
  resolveInspectionDrawingEditMode,
  sheetUsesProductionInspectionDrawingUi
} from './productionInspectionDrawingPolicy';

import type { PartMeasurementSheetDto, PartMeasurementTemplateDto } from '../types';

function drawingTemplate(overrides?: Partial<PartMeasurementTemplateDto>): PartMeasurementTemplateDto {
  return {
    id: 'tpl-1',
    fhincd: 'ABC',
    resourceCd: 'R1',
    processGroup: 'cutting',
    templateScope: 'three_key',
    candidateFhinmei: null,
    name: 'T',
    version: 1,
    isActive: true,
    visualTemplateId: 'vt-1',
    visualTemplate: {
      id: 'vt-1',
      name: '図',
      drawingImageRelativePath: '/api/storage/part-measurement-drawings/x.png',
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

function sheetWith(
  template: PartMeasurementTemplateDto,
  quantity: number | null
): PartMeasurementSheetDto {
  return {
    id: 'sheet-1',
    sessionId: 'sess',
    status: 'DRAFT',
    productNo: 'PN',
    fseiban: 'FS',
    fhincd: template.fhincd,
    fhinmei: '品',
    machineName: null,
    resourceCdSnapshot: 'R1',
    processGroupSnapshot: 'cutting',
    employeeId: null,
    employeeNameSnapshot: null,
    createdByEmployeeId: null,
    createdByEmployeeNameSnapshot: null,
    finalizedByEmployeeId: null,
    finalizedByEmployeeNameSnapshot: null,
    quantity,
    scannedBarcodeRaw: null,
    templateId: template.id,
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
    template,
    results: []
  };
}

describe('productionInspectionDrawingPolicy', () => {
  it('routes production drawing template with quantity 1 to production mode', () => {
    const tpl = drawingTemplate();
    const sheet = sheetWith(tpl, 1);
    expect(sheetUsesProductionInspectionDrawingUi(sheet)).toBe(true);
    expect(resolveInspectionDrawingEditMode(sheet)).toBe('production');
    expect(getInspectionDrawingEditAccess(sheet).allowed).toBe(true);
  });

  it('keeps quantity>1 on table flow', () => {
    const tpl = drawingTemplate();
    const sheet = sheetWith(tpl, 2);
    expect(sheetUsesProductionInspectionDrawingUi(sheet)).toBe(false);
    expect(getInspectionDrawingEditAccess(sheet).allowed).toBe(false);
  });

  it('keeps quantity null on table flow until explicitly 1', () => {
    const tpl = drawingTemplate();
    const sheet = sheetWith(tpl, null);
    expect(sheetUsesProductionInspectionDrawingUi(sheet)).toBe(false);
  });

  it('excludes evaluation bucket from production eligibility', () => {
    const tpl = drawingTemplate({
      fhincd: PART_MEASUREMENT_INSPECTION_DRAWING_EVAL_BUCKET_FHINCD,
      processGroup: null
    });
    expect(productionTemplateEligibleForInspectionDrawingUi(tpl)).toBe(false);
    const sheet = sheetWith(tpl, 1);
    expect(resolveInspectionDrawingEditMode(sheet)).toBe('evaluation');
  });
});
