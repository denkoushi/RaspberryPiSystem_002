import { KIOSK_INITIAL_ROUTE_PATHS, resolveKioskDefaultModePath } from '@raspi-system/shared-types';

import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

export function resolveKioskHeaderTabPath(tabId: KioskReorderableHeaderTabId, defaultMode?: 'PHOTO' | 'TAG'): string {
  switch (tabId) {
    case 'borrow': return resolveKioskDefaultModePath(defaultMode);
    case 'tag_desk': return '/kiosk/tag-desk';
    case 'due_management': return '/kiosk/production-schedule/due-management';
    default: return KIOSK_INITIAL_ROUTE_PATHS[tabId];
  }
}
