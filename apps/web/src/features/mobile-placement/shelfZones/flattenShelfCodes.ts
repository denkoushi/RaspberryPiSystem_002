import type { ShelfZoneCatalog } from './shelfZoneTypes';

/** catalog 内の全棚番号を重複除去せずに平坦化（表示・検証用） */
export function flattenShelfCodes(catalog: ShelfZoneCatalog): string[] {
  return catalog.zones.flatMap((z) => [...z.shelfCodes]);
}
