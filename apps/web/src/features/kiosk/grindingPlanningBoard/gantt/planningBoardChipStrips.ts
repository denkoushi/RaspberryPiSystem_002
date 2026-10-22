import type { KioskResourceProgressProcessChip } from '../../../../components/kiosk/resourceProgress/KioskResourceProcessChips';

export const CHIP_LINE_HEIGHT = 20;
const STRIP_GAP = 8;

/** Width of one row of resource-CD chips (10px text, px-1, border, gap-0.5), rounded up so strips never touch. */
export function estimateChipStripWidth(chips: readonly KioskResourceProgressProcessChip[]): number {
  return chips.reduce((sum, chip) => sum + chip.resourceCd.length * 7 + 12, 0) + Math.max(0, chips.length - 1) * 2;
}

/** Puts each strip on the first line where it does not touch the strip before it, so chips never overlap. */
export function layoutChipStrips<T extends { left: number; width: number }>(strips: readonly T[]): { strips: (T & { line: number })[]; lines: number } {
  const lineEnds: number[] = [];
  const placed = [...strips].sort((a, b) => a.left - b.left).map((strip) => {
    let line = lineEnds.findIndex((end) => end + STRIP_GAP <= strip.left);
    if (line < 0) line = lineEnds.length;
    lineEnds[line] = strip.left + strip.width;
    return { ...strip, line };
  });
  return { strips: placed, lines: lineEnds.length };
}
