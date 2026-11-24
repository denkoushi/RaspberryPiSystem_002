import { KIOSK_INITIAL_ROUTE_PATHS, KIOSK_REORDERABLE_HEADER_TAB_IDS } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import appSource from '../../../App.tsx?raw';
import * as assemblyRoutes from '../../assembly/assemblyRoutes';

import { isKioskHeaderTabActive, resolveActiveKioskHeaderTab, resolveCurrentKioskInitialRoute } from './kioskHeaderTabActivity';

describe('shared header activity', () => {
  it.each([
    ['/kiosk/tag', 'borrow', 'borrow_tag'],
    ['/kiosk/photo', 'borrow', 'borrow_photo'],
    ['/kiosk', 'borrow', 'borrow_tag'],
    ['/kiosk/inventory/haizen', 'inventory_settings', 'inventory_haizen'],
    ['/kiosk/inventory/haizen/', 'inventory_settings', 'inventory_haizen'],
    ['/kiosk/inventory/haizen/verify-history', 'inventory_settings', 'inventory_haizen_verify_history'],
    ['/kiosk/inventory/settings/', 'inventory_settings', null],
    ['/kiosk/assembly/manuals/workshop', 'assembly', null],
    ['/kiosk/assembly/record-approvals', 'assembly', null],
    ['/kiosk/assembly/traceability', 'assembly', null],
    ['/kiosk/assembly/templates/example/edit', 'assembly', 'assembly'],
    ['/kiosk/part-measurement/self-inspection/sessions/example', 'self_inspection', 'self_inspection'],
    ['/kiosk/part-measurement/self-inspection/record-approvals', 'self_inspection', 'self_inspection_record_approvals'],
    ['/kiosk/part-measurement/inspection/templates/example/edit', 'inspection_drawing', 'inspection_drawing'],
    ['/kiosk/mobile-placement/part-search', undefined, 'mobile_placement_part_search'],
    ['/kiosk/tag-desk', 'tag_desk', null],
    ['/kiosk/production-schedule/due-management', 'due_management', null],
    ['/kiosk/unknown', undefined, null]
  ] as const)('resolves the active tab and startup page for %s', (pathname, tab, route) => {
    expect(resolveActiveKioskHeaderTab(pathname)).toBe(tab);
    expect(resolveCurrentKioskInitialRoute(pathname)).toBe(route);
    expect(KIOSK_REORDERABLE_HEADER_TAB_IDS.filter((id) => isKioskHeaderTabActive(id, pathname))[0]).toBe(tab);
  });
});

it('recognizes the fixed portal tab as a startup page', () => {
  expect(resolveCurrentKioskInitialRoute('/kiosk/portal')).toBe('portal');
  expect(resolveCurrentKioskInitialRoute('/kiosk/portal/')).toBe('portal');
});

it('registers every startup page in App.tsx', () => {
  const assemblyPaths = new Map<string, unknown>(Object.entries(assemblyRoutes));
  const appPaths = Array.from(
    appSource.matchAll(/<Route\s+path=(?:"([^"]+)"|\{(KIOSK_ASSEMBLY_\w+)\})/g),
    ([, literal, constant]) => literal ?? assemblyPaths.get(constant)
  );
  expect(appPaths).toEqual(expect.arrayContaining(Object.values(KIOSK_INITIAL_ROUTE_PATHS)));
});
