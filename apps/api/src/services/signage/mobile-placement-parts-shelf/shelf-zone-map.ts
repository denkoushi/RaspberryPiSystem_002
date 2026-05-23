import {
  macroZoneIdFromStructured,
  PARTS_SHELF_ZONE_DIR_LABEL,
  type MacroZoneId
} from '@raspi-system/shelf-layout-core';

import type { RegisteredShelfEntry } from '../../mobile-placement/mobile-placement-registered-shelves.service.js';

export type PartsShelfZoneId = MacroZoneId;

export { PARTS_SHELF_ZONE_DIR_LABEL };

/**
 * `parseStructuredShelfCode` の areaId / lineId から 3×3 のゾーンIDへ。
 * 構造化できない棚は null。
 */
export function shelfEntryToZoneId(entry: Omit<RegisteredShelfEntry, 'shelfCodeRaw'>): PartsShelfZoneId | null {
  if (!entry.isStructured || !entry.areaId || !entry.lineId) {
    return null;
  }
  return macroZoneIdFromStructured(entry.areaId, entry.lineId);
}
