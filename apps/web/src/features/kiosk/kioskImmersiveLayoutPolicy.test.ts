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
    ['/kiosk/photo'],
    ['/kiosk/instruments/borrow'],
    ['/kiosk/rigging/borrow'],
    ['/kiosk/production-schedule'],
    ['/kiosk/production-schedule/'],
    ['/kiosk/production-schedule/manual-order'],
    ['/kiosk/production-schedule/manual-order/extra'],
    ['/kiosk/production-schedule/leader-order-board'],
    ['/kiosk/production-schedule/leader-order-board/'],
    ['/kiosk/production-schedule/progress-overview'],
    ['/kiosk/production-schedule/progress-overview/'],
    ['/kiosk/production-schedule/load-balancing'],
    ['/kiosk/production-schedule/load-balancing/'],
    ['/kiosk/documents'],
    ['/kiosk/documents/'],
    ['/kiosk/assembly'],
    ['/kiosk/assembly/'],
    ['/kiosk/assembly/templates/new'],
    ['/kiosk/assembly/templates/00000000-0000-4000-8000-000000000003/edit'],
    ['/kiosk/assembly/library'],
    ['/kiosk/assembly/work-sessions/00000000-0000-4000-8000-000000000004'],
    ['/kiosk/part-measurement'],
    ['/kiosk/part-measurement/'],
    ['/kiosk/part-measurement/edit/00000000-0000-4000-8000-000000000001'],
    ['/kiosk/part-measurement/template/pick'],
    ['/kiosk/part-measurement/template/new'],
    ['/kiosk/part-measurement/finalized'],
    ['/kiosk/part-measurement/inspection/create'],
    ['/kiosk/part-measurement/inspection/edit/00000000-0000-4000-8000-000000000002'],
    ['/dev/kiosk-inspection-drawing-library'],
    ['/dev/kiosk-inspection-drawing-create'],
    ['/dev/kiosk-assembly-library'],
    ['/dev/kiosk-assembly-template-editor'],
    ['/kiosk/mobile-placement'],
    ['/kiosk/mobile-placement/register'],
    ['/kiosk/mobile-placement/shelf-register'],
    ['/kiosk/purchase-order-lookup'],
    ['/kiosk/purchase-order-lookup/'],
    ['/kiosk/pallet-visualization'],
    ['/kiosk/pallet-visualization/']
  ])('true for %s', (path) => {
    expect(usesKioskImmersiveLayout(path)).toBe(true);
  });

  it.each([
    ['/kiosk'],
    ['/kiosk/call'],
    ['/kiosk/production-schedule/due-management'],
    ['/kiosk/production-schedule/other'],
    ['/admin']
  ])('false for %s', (path) => {
    expect(usesKioskImmersiveLayout(path)).toBe(false);
  });
});
