import { describe, expect, it } from 'vitest';

import {
  isKioskInspectionDrawingPath,
  isKioskPartMeasurementHubPath,
  KIOSK_INSPECTION_DRAWING_CREATE_PATH
} from './kioskInspectionDrawingRoutes';

describe('kioskInspectionDrawingRoutes', () => {
  it('create path constant', () => {
    expect(KIOSK_INSPECTION_DRAWING_CREATE_PATH).toBe('/kiosk/part-measurement/inspection/create');
  });

  it('inspection paths are not part-measurement hub', () => {
    expect(isKioskInspectionDrawingPath('/kiosk/part-measurement/inspection/create')).toBe(true);
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement/inspection/create')).toBe(false);
  });

  it('part-measurement hub excludes inspection prefix', () => {
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement')).toBe(true);
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement/')).toBe(true);
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement/edit/x')).toBe(true);
    expect(isKioskPartMeasurementHubPath('/kiosk/part-measurement/inspection/edit/x')).toBe(false);
  });
});
