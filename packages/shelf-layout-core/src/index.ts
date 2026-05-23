export {
  MACRO_ZONE_CATALOG,
  PARTS_SHELF_ZONE_DIR_LABEL,
  getMacroZoneById,
  getNeighborMacroZoneId,
  indexToRc,
  macroZoneIdFromStructured,
  rcToIndex,
  shelfPrefixForMacroZone,
  type MacroZoneDefinition,
  type MacroZoneId,
  type ShelfAreaId,
  type ShelfLineId
} from './zone-catalog.js';
export {
  directionBetween,
  nearestMachineDirection,
  type CardinalDirection,
  type MachineAnchor,
  type NearestMachineResult
} from './direction.js';
export { buildAutoDisplayLabel, dedupeDisplayLabel, type DisplayLabelInput } from './display-label.js';
export {
  areOrthogonallyAdjacent,
  validateAdjacentRectangle,
  type AdjacencyValidationResult
} from './adjacency.js';
export { allocateShelfCode, formatShelfCodeRaw } from './shelf-code.js';