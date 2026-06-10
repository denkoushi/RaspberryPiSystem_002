import {
  DEFAULT_KIOSK_HEADER_TAB_ORDER,
  KIOSK_HEADER_TAB_ORDER_SCOPE_SHARED,
  normalizeKioskHeaderTabOrder,
  type KioskReorderableHeaderTabId
} from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';

export type KioskHeaderTabOrderSettings = {
  scopeKey: typeof KIOSK_HEADER_TAB_ORDER_SCOPE_SHARED;
  tabOrder: KioskReorderableHeaderTabId[];
};

export async function getKioskHeaderTabOrderSettings(): Promise<KioskHeaderTabOrderSettings> {
  const row = await prisma.kioskHeaderTabOrderConfig.findUnique({
    where: { scopeKey: KIOSK_HEADER_TAB_ORDER_SCOPE_SHARED },
    select: { tabOrder: true }
  });

  return {
    scopeKey: KIOSK_HEADER_TAB_ORDER_SCOPE_SHARED,
    tabOrder: normalizeKioskHeaderTabOrder(row?.tabOrder ?? DEFAULT_KIOSK_HEADER_TAB_ORDER)
  };
}

export async function upsertKioskHeaderTabOrderSettings(
  tabOrder: readonly string[]
): Promise<KioskHeaderTabOrderSettings> {
  const normalized = normalizeKioskHeaderTabOrder(tabOrder);

  await prisma.kioskHeaderTabOrderConfig.upsert({
    where: { scopeKey: KIOSK_HEADER_TAB_ORDER_SCOPE_SHARED },
    create: {
      scopeKey: KIOSK_HEADER_TAB_ORDER_SCOPE_SHARED,
      tabOrder: [...normalized]
    },
    update: {
      tabOrder: [...normalized]
    }
  });

  return {
    scopeKey: KIOSK_HEADER_TAB_ORDER_SCOPE_SHARED,
    tabOrder: normalized
  };
}
