import { describe, expect, it } from 'vitest';

import { resolveKioskPartMeasurementSheetEditPath } from './kioskPartMeasurementSheetNavigation';

import type { PartMeasurementSheetDto, PartMeasurementTemplateDto } from './types';

function sheet(quantity: number | null, template: PartMeasurementTemplateDto): PartMeasurementSheetDto {
  return {
    id: 's1',
    sessionId: 'sess',
    status: 'DRAFT',
    productNo: 'PN',
    fseiban: 'FS',
    fhincd: template.fhincd,
    fhinmei: '品',
    machineName: null,
    resourceCdSnapshot: 'R',
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

describe('resolveKioskPartMeasurementSheetEditPath', () => {
  const tpl: PartMeasurementTemplateDto = {
    id: 't1',
    fhincd: 'FH',
    resourceCd: 'R',
    processGroup: 'cutting',
    templateScope: 'three_key',
    candidateFhinmei: null,
    name: 'T',
    version: 1,
    isActive: true,
    visualTemplateId: 'v1',
    visualTemplate: {
      id: 'v1',
      name: '図',
      drawingImageRelativePath: '/api/storage/x.png',
      isActive: true,
      createdAt: '',
      updatedAt: ''
    },
    items: [
      {
        id: 'i1',
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
    ]
  };

  it('returns inspection edit for production drawing sheet with quantity 1', () => {
    expect(resolveKioskPartMeasurementSheetEditPath(sheet(1, tpl))).toBe(
      '/kiosk/part-measurement/inspection/edit/s1'
    );
  });

  it('returns table edit for quantity 2', () => {
    expect(resolveKioskPartMeasurementSheetEditPath(sheet(2, tpl))).toBe(
      '/kiosk/part-measurement/edit/s1'
    );
  });
});
