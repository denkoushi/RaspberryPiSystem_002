import { KIOSK_REORDERABLE_HEADER_TAB_IDS } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import { isKioskHeaderTabActive, resolveActiveKioskHeaderTab, resolveCurrentKioskInitialRoute } from './kioskHeaderTabActivity';

describe('shared header activity', () => {
  it.each([
    ['/kiosk/tag', 'borrow', 'borrow_tag'],
    ['/kiosk/photo', 'borrow', 'borrow_photo'],
    ['/kiosk/inventory/settings', 'inventory_settings', 'inventory_settings'],
    ['/kiosk/part-measurement/self-inspection/records', 'self_inspection', 'self_inspection'],
    ['/kiosk/part-measurement/inspection/templates/example/edit', 'inspection_drawing', 'inspection_drawing'],
    ['/kiosk/tag-desk', 'tag_desk', null],
    ['/kiosk/production-schedule/due-management', 'due_management', null],
    ['/kiosk/unknown', undefined, null]
  ] as const)('uses existing tab selection for %s', (pathname, tab, route) => {
    expect(resolveActiveKioskHeaderTab(pathname)).toBe(tab);
    expect(resolveCurrentKioskInitialRoute(pathname)).toBe(route);
    expect(KIOSK_REORDERABLE_HEADER_TAB_IDS.filter((id) => isKioskHeaderTabActive(id, pathname))[0]).toBe(tab);
  });
});
