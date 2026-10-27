import { getMobilePlacementRegisteredShelves, getMobilePlacementShelfMachines } from '../../api/client';

type Shelves = Awaited<ReturnType<typeof getMobilePlacementRegisteredShelves>>;
type Machines = Awaited<ReturnType<typeof getMobilePlacementShelfMachines>>;

const SHELVES_KEY = 'mobile-placement-registered-shelves-v1';
const MACHINES_KEY = 'mobile-placement-shelf-machines-v1';
const REQUEST_TIMEOUT_MS = 5000;

function readCache<T>(key: string, valid: (value: unknown) => value is T): T | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (valid(value)) return value;
  } catch { /* Storage can be unavailable or contain an incomplete value. */ }
}

const validShelves = (value: unknown): value is Shelves => Boolean(value && typeof value === 'object' && 'shelves' in value && Array.isArray(value.shelves) &&
    value.shelves.every((shelf: unknown) => shelf && typeof shelf === 'object' && 'shelfCodeRaw' in shelf && typeof shelf.shelfCodeRaw === 'string' &&
      'isStructured' in shelf && typeof shelf.isStructured === 'boolean'));

const validMachines = (value: unknown): value is Machines => Boolean(value && typeof value === 'object' && 'machines' in value && Array.isArray(value.machines) &&
    value.machines.every((name: unknown) => typeof name === 'string') && 'landmarks' in value && Array.isArray(value.landmarks) &&
    value.landmarks.every((name: unknown) => typeof name === 'string'));

export const readCachedRegisteredShelves = () => readCache(SHELVES_KEY, validShelves);
export const readCachedShelfMachines = () => readCache(MACHINES_KEY, validMachines);

async function withShelfCache<T>(key: string, fetch: () => Promise<T>, cached: T | undefined, refresh: boolean): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (cached !== undefined) return cached;
    throw new Error('Shelf list unavailable offline');
  }
  const update = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await Promise.race([
        fetch(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Shelf list request timed out')), REQUEST_TIMEOUT_MS);
        })
      ]);
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep the live result if storage is full. */ }
      return value;
    } finally {
      clearTimeout(timer);
    }
  };
  if (cached !== undefined && !refresh) {
    void update().catch(() => {});
    return cached;
  }
  try {
    return await update();
  } catch (error) {
    if (cached !== undefined) return cached;
    throw error;
  }
}

// Query observers display initialData immediately and await refresh to update the screen.
export const getCachedRegisteredShelves = ({ refresh = false } = {}) =>
  withShelfCache(SHELVES_KEY, getMobilePlacementRegisteredShelves, readCachedRegisteredShelves(), refresh);
export const getCachedShelfMachines = ({ refresh = false } = {}) =>
  withShelfCache(MACHINES_KEY, getMobilePlacementShelfMachines, readCachedShelfMachines(), refresh);
