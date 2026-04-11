import { SHELF_AREA_OPTIONS, SHELF_LINE_OPTIONS } from './defaultShelfRegisterCatalog';

import type { ShelfSelection } from './shelfSelectionTypes';


function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function labelForArea(areaId: ShelfSelection['areaId']): string | undefined {
  return SHELF_AREA_OPTIONS.find((o) => o.id === areaId)?.label;
}

function labelForLine(lineId: ShelfSelection['lineId']): string | undefined {
  return SHELF_LINE_OPTIONS.find((o) => o.id === lineId)?.label;
}

/**
 * API `shelfCodeRaw` 用の表示文字列（例: 西-北-02）
 */
export function formatShelfCodeRaw(selection: ShelfSelection): string {
  const a = labelForArea(selection.areaId);
  const l = labelForLine(selection.lineId);
  if (!a || !l) {
    throw new Error('Invalid shelf selection ids');
  }
  return `${a}-${l}-${pad2(selection.slot)}`;
}
