import { getMobilePlacementRegisteredShelves, getMobilePlacementShelfMachines } from '../../api/client';

type Shelves = Awaited<ReturnType<typeof getMobilePlacementRegisteredShelves>>;
type Machines = Awaited<ReturnType<typeof getMobilePlacementShelfMachines>>;

async function withShelfCache<T>(key: string, fetch: () => Promise<T>, valid: (value: unknown) => value is T): Promise<T> {
  let cached: T | undefined;
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (valid(value)) cached = value;
  } catch { /* Storage can be unavailable or contain an incomplete value. */ }
  if (typeof navigator !== 'undefined' && navigator.onLine === false && cached) return cached;
  try {
    const value = await fetch();
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep the live result if storage is full. */ }
    return value;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

export const getCachedRegisteredShelves = () => withShelfCache('mobile-placement-registered-shelves-v1', getMobilePlacementRegisteredShelves,
  (value): value is Shelves => Boolean(value && typeof value === 'object' && 'shelves' in value && Array.isArray(value.shelves) &&
    value.shelves.every((shelf: unknown) => shelf && typeof shelf === 'object' && 'shelfCodeRaw' in shelf && typeof shelf.shelfCodeRaw === 'string' &&
      'isStructured' in shelf && typeof shelf.isStructured === 'boolean')));

export const getCachedShelfMachines = () => withShelfCache('mobile-placement-shelf-machines-v1', getMobilePlacementShelfMachines,
  (value): value is Machines => Boolean(value && typeof value === 'object' && 'machines' in value && Array.isArray(value.machines) &&
    value.machines.every((name: unknown) => typeof name === 'string') && 'landmarks' in value && Array.isArray(value.landmarks) &&
    value.landmarks.every((name: unknown) => typeof name === 'string')));
