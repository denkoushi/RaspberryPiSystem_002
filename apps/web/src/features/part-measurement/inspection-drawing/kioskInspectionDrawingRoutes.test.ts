import { describe, expect, it } from 'vitest';

import {
  isKioskInspectionDrawingPath,
  isKioskPartMeasurementHubPath,
  kioskInspectionDrawingTemplateEditPath,
  KIOSK_INSPECTION_DRAWING_CREATE_PATH,
  KIOSK_INSPECTION_DRAWING_LIBRARY_PATH
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
