import { isValidShelfSlot } from './isValidShelfSlot';

import type { ShelfAreaId, ShelfLineId, ShelfSelection } from './shelfSelectionTypes';

export function isCompleteShelfSelection(
  partial: Partial<{ areaId: ShelfAreaId; lineId: ShelfLineId; slot: number }>
): partial is ShelfSelection {
  return (
    partial.areaId != null &&
    partial.lineId != null &&
    partial.slot != null &&
    isValidShelfSlot(partial.slot)
  );
}
