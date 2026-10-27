import { SHELF_DIRECTIONS, type ShelfDirection } from '@raspi-system/shelf-layout-core';

const key = 'mobile-placement:shelf-photo-draft';
type ShelfPhotoDraft = { machine: string; direction: ShelfDirection | '' | null; memo: string };

export function readShelfPhotoDraft(): ShelfPhotoDraft | null {
  try {
    const value = sessionStorage.getItem(key);
    if (!value) return null;
    const draft = JSON.parse(value) as ShelfPhotoDraft;
    if (typeof draft?.machine !== 'string' || typeof draft.memo !== 'string' ||
      !(draft.direction === null || draft.direction === '' || SHELF_DIRECTIONS.includes(draft.direction))) return null;
    return { machine: draft.machine, direction: draft.direction, memo: draft.memo };
  } catch { return null; }
}

export function saveShelfPhotoDraft(draft: ShelfPhotoDraft) {
  try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* Storage may be unavailable. */ }
}

export function clearShelfPhotoDraft() {
  try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ }
}
