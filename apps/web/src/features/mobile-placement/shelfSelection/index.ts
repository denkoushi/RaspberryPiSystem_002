export type {
  ShelfAreaId,
  ShelfAxisOption,
  ShelfLineId,
  ShelfSelection
} from './shelfSelectionTypes';
export {
  SHELF_AREA_OPTIONS,
  SHELF_LINE_OPTIONS,
  SHELF_SLOT_MAX
} from './defaultShelfRegisterCatalog';
export { getOccupiedSlotsForRegisteredShelves } from './occupiedSlotsFromRegisteredShelves';
export { formatShelfCodeRaw } from './formatShelfCodeRaw';
export { isValidShelfSlot } from './isValidShelfSlot';
export { isCompleteShelfSelection } from './isCompleteShelfSelection';
export type { MobilePlacementShelfRegisterRouteState, OrderPlacementPageIntent } from './navigationState';
export { isMobilePlacementShelfRegisterRouteState } from './navigationState';
