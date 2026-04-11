import type { ShelfZoneDefinition, ShelfZoneId } from './shelfZoneTypes';

export function findZoneById(
  zones: readonly ShelfZoneDefinition[],
  id: ShelfZoneId
): ShelfZoneDefinition | undefined {
  return zones.find((z) => z.id === id);
}
