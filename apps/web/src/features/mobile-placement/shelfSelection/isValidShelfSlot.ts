import { SHELF_SLOT_MAX } from './defaultShelfRegisterCatalog';

/** 1〜SHELF_SLOT_MAX の整数なら true */
export function isValidShelfSlot(slot: number): boolean {
  if (!Number.isFinite(slot)) return false;
  const n = Math.floor(slot);
  return n >= 1 && n <= SHELF_SLOT_MAX;
}
