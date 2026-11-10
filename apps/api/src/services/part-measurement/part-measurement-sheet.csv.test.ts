import { describe, expect, it } from 'vitest';

import { PartMeasurementSheetService } from './part-measurement-sheet.service.js';

describe('PartMeasurementSheetService CSV', () => {
  it('formats header and detail cells while preserving numeric measurements', () => {
    const sheet = {
      id: 'sheet-1', sessionId: 'session-1', status: 'DRAFT', productNo: '=SUM(A1)',
      fseiban: '+1+1', fhincd: '-1+1', fhinmei: 'part,"name"\nline', machineName: '@x',
      resourceCdSnapshot: '\tresource', processGroupSnapshot: 'CUTTING', quantity: 1,
      createdAt: new Date('2026-01-01T00:00:00Z'), finalizedAt: null,
      createdByEmployeeNameSnapshot: 'normal', finalizedByEmployeeNameSnapshot: null,
      employeeNameSnapshot: null,
      template: { items: [{ id: 'item-1', sortOrder: 0, displayMarker: '@marker',
        datumSurface: '=datum', measurementPoint: '+point', measurementLabel: '-label', unit: 'mm' }] },
      results: [{ templateItemId: 'item-1', pieceIndex: 0, value: '-0.5' }]
    } as Parameters<PartMeasurementSheetService['buildSheetCsv']>[0];
    const csv = new PartMeasurementSheetService().buildSheetCsv(sheet);
    expect(csv).toContain('rowType,key,value\nH,id,sheet-1\nH,sessionId,session-1\n');
    expect(csv).toContain("H,productNo,'=SUM(A1)\n");
    expect(csv).toContain("H,fseiban,'+1+1\n");
    expect(csv).toContain("H,fhincd,'-1+1\n");
    expect(csv).toContain('H,fhinmei,"part,""name""\nline"\n');
    expect(csv).toContain("H,machineName,'@x\n");
    expect(csv).toContain("H,resourceCd,'\tresource\n");
    expect(csv).toContain('H,quantity,1\n');
    expect(csv).toContain('rowType,pieceIndex,displayMarker,datumSurface,measurementPoint,measurementLabel,unit,value\n');
    expect(csv).toContain("D,1,'@marker,'=datum,'+point,'-label,mm,-0.5\n");
  });
});
