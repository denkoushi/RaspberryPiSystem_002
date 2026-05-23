/**
 * 区画 prefix + 連番から正本棚 ID を生成（例: 西-北-02）。
 */
export function formatShelfCodeRaw(prefix: string, slot: number): string {
  if (!Number.isInteger(slot) || slot < 1 || slot > 99) {
    throw new RangeError('slot must be 1..99');
  }
  return `${prefix}-${String(slot).padStart(2, '0')}`;
}

export function allocateShelfCode(
  prefix: string,
  currentNextShelfSlot: number
): {
  shelfCodeRaw: string;
  nextShelfSlot: number;
} {
  if (currentNextShelfSlot < 1 || currentNextShelfSlot > 99) {
    throw new RangeError('nextShelfSlot must be 1..99');
  }
  return {
    shelfCodeRaw: formatShelfCodeRaw(prefix, currentNextShelfSlot),
    nextShelfSlot: currentNextShelfSlot + 1
  };
}
