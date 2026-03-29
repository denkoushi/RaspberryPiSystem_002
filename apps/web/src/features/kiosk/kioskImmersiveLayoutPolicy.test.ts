import { describe, expect, it } from 'vitest';

import { normalizeKioskPathname, usesKioskImmersiveLayout } from './kioskImmersiveLayoutPolicy';

describe('normalizeKioskPathname', () => {
  it('strips trailing slashes', () => {
    expect(normalizeKioskPathname('/kiosk/production-schedule/')).toBe('/kiosk/production-schedule');
  });

  it('returns slash for empty after trim', () => {
    expect(normalizeKioskPathname('   ')).toBe('/');
  });
});

describe('usesKioskImmersiveLayout', () => {
  it.each([
    ['/kiosk/tag'],
    ['/kiosk/instruments/borrow'],
    ['/kiosk/rigging/borrow'],
    ['/kiosk/production-schedule'],
    ['/kiosk/production-schedule/'],
    ['/kiosk/production-schedule/manual-order'],
    ['/kiosk/production-schedule/manual-order/extra'],
    ['/kiosk/production-schedule/progress-overview'],
    ['/kiosk/production-schedule/progress-overview/'],
    ['/kiosk/documents'],
    ['/kiosk/documents/'],
    ['/kiosk/part-measurement'],
    ['/kiosk/part-measurement/'],
    ['/kiosk/part-measurement/edit/00000000-0000-4000-8000-000000000001'],
    ['/kiosk/part-measurement/template/new'],
    ['/kiosk/part-measurement/finalized']
  ])('true for %s', (path) => {
    expect(usesKioskImmersiveLayout(path)).toBe(true);
  });

  it.each([
    ['/kiosk'],
    ['/kiosk/photo'],
    ['/kiosk/call'],
    ['/kiosk/production-schedule/due-management'],
    ['/kiosk/production-schedule/other'],
    ['/admin']
  ])('false for %s', (path) => {
    expect(usesKioskImmersiveLayout(path)).toBe(false);
  });
});
