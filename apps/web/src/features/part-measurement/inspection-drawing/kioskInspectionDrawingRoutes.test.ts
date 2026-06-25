import { describe, expect, it } from 'vitest';

import {
  isKioskInspectionDrawingPath,
  isKioskPartMeasurementHubPath,
  kioskInspectionDrawingCreatePathWithSource,
  kioskInspectionDrawingPaperReportPrintPath,
  kioskInspectionDrawingTemplateEditPath,
  kioskInspectionDrawingTemplatePrintPath,
  KIOSK_INSPECTION_DRAWING_CREATE_PATH,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH,
  parseInspectionDrawingPrintPlannedQuantityFromSearch,
  parseInspectionDrawingSourceTemplateIdFromSearch
} from './kioskInspectionDrawingRoutes';

describe('kioskInspectionDrawingRoutes', () => {
  it('library path constant', () => {
    expect(KIOSK_INSPECTION_DRAWING_LIBRARY_PATH).toBe('/kiosk/part-measurement/inspection');
  });

  it('create path constant', () => {
    expect(KIOSK_INSPECTION_DRAWING_CREATE_PATH).toBe('/kiosk/part-measurement/inspection/create');
  });

  it('template edit path helper', () => {
    expect(kioskInspectionDrawingTemplateEditPath('abc')).toBe(
      '/kiosk/part-measurement/inspection/templates/abc/edit'
    );
  });

  it('template print path helper', () => {
    expect(kioskInspectionDrawingTemplatePrintPath('abc')).toBe(
      '/kiosk/part-measurement/inspection/templates/abc/print'
    );
  });

  it('template print path helper adds planned quantity when provided', () => {
    expect(kioskInspectionDrawingTemplatePrintPath('abc', { plannedQuantity: 3 })).toBe(
      '/kiosk/part-measurement/inspection/templates/abc/print?plannedQuantity=3'
    );
    expect(parseInspectionDrawingPrintPlannedQuantityFromSearch('?plannedQuantity=3')).toBe(3);
    expect(parseInspectionDrawingPrintPlannedQuantityFromSearch('?plannedQuantity=0')).toBeNull();
    expect(parseInspectionDrawingPrintPlannedQuantityFromSearch('?plannedQuantity=2001')).toBe(2000);
  });

  it('paper report print path helper', () => {
    expect(kioskInspectionDrawingPaperReportPrintPath('report-1')).toBe(
      '/kiosk/part-measurement/inspection/paper-reports/report-1/print'
    );
  });

  it('parses sourceTemplateId from query', () => {
    expect(
      parseInspectionDrawingSourceTemplateIdFromSearch(
        '?sourceTemplateId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      )
    ).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(parseInspectionDrawingSourceTemplateIdFromSearch('')).toBeNull();
  });

  it('create path with sourceTemplateId query', () => {
    expect(kioskInspectionDrawingCreatePathWithSource('src-uuid')).toBe(
      '/kiosk/part-measurement/inspection/create?sourceTemplateId=src-uuid'
    );
  });

  it('inspection paths are not part-measurement hub', () => {
    expect(isKioskInspectionDrawingPath('/kiosk/part-measurement/inspection')).toBe(true);
    expect(isKioskInspectionDrawingPath('/kiosk/part-measurement/inspection/create')).toBe(true);
    expect(isKioskInspectionDrawingPath('/kiosk/part-measurement/inspection/templates/x/edit')).toBe(true);
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement/inspection/create')).toBe(false);
  });

  it('part-measurement hub excludes inspection prefix', () => {
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement')).toBe(true);
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement/')).toBe(true);
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement/edit/x')).toBe(true);
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement/inspection/edit/x')).toBe(false);
  });
});
