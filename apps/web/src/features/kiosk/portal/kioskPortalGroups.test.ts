import { KIOSK_REORDERABLE_HEADER_TAB_IDS } from '@raspi-system/shared-types';
import { describe, expect, it } from 'vitest';

import { groupKioskPortalTabs, KIOSK_PORTAL_GROUPS } from './kioskPortalGroups';

import type { KioskReorderableHeaderTabId } from '@raspi-system/shared-types';

describe('portal groups', () => {
  it('covers every reorderable tab exactly once in five groups', () => {
    const ids = KIOSK_PORTAL_GROUPS.flatMap((group) => group.tabIds);
    expect(KIOSK_PORTAL_GROUPS).toHaveLength(5);
    expect(ids.slice().sort()).toEqual([...KIOSK_REORDERABLE_HEADER_TAB_IDS].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('keeps header order inside each group', () => {
    const order = [...KIOSK_REORDERABLE_HEADER_TAB_IDS].reverse();
    const groups = groupKioskPortalTabs(order);
    groups.forEach((group, index) => expect(group.tabIds).toEqual(order.filter((id) => KIOSK_PORTAL_GROUPS[index].tabIds.includes(id))));
  });
  it('places future ungrouped tabs in the last group', () => {
    const futureId = 'future_tab' as KioskReorderableHeaderTabId;
    expect(groupKioskPortalTabs([futureId, 'call']).at(-1)?.tabIds).toEqual([futureId, 'call']);
  });
});
