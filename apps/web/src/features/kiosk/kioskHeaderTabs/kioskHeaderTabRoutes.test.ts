import { KIOSK_REORDERABLE_HEADER_TAB_IDS, KIOSK_INITIAL_ROUTE_PATHS } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import { resolveKioskHeaderTabPath } from './kioskHeaderTabRoutes';

describe('shared header and portal route resolution', () => {
  it.each([['TAG', '/kiosk/tag'], ['PHOTO', '/kiosk/photo'], [undefined, '/kiosk/tag']] as const)('resolves borrow mode %s', (mode, path) => {
    expect(resolveKioskHeaderTabPath('borrow', mode)).toBe(path);
  });
  it.each(KIOSK_REORDERABLE_HEADER_TAB_IDS)('resolves %s to the existing destination', (id) => {
    const expected = id === 'borrow' ? '/kiosk/tag' : id === 'tag_desk' ? '/kiosk/tag-desk' : id === 'due_management' ? '/kiosk/production-schedule/due-management' : KIOSK_INITIAL_ROUTE_PATHS[id];
    expect(resolveKioskHeaderTabPath(id)).toBe(expected);
  });
});
