import type { KioskResourceProgressProcessChip } from '../../../../components/kiosk/resourceProgress/KioskResourceProcessChips';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

export const CHIP_LINE_HEIGHT = 20;
const STRIP_GAP = 8;
const CHIP_GAP = 2;

/** How chip strips share a lane: how many lines at most, and whether completed chips fold into one 「済N」 chip. */
export type ChipStripFit = { maxLines: number; collapseDone: boolean };
/** The board's choice: fold completed chips and use at most two lines, so lanes stay short. */
export const CHIP_STRIP_FIT: ChipStripFit = { maxLines: 2, collapseDone: true };

const chipWidth = (text: string) => [...text].reduce((sum, char) => sum + (char.charCodeAt(0) > 0xff ? 11 : 7), 0) + 12;
/** Reserve the placement badge's text, pin and gaps using the same conservative glyph widths as process chips. */
export function planningBoardBadgeWidth(item: GrindingPlanningBoardItem): number {
  const shelves = item.placement?.shelves;
  return shelves?.length ? chipWidth(shelves[0]!.label + (shelves.length > 1 ? `+${shelves.length - 1}` : '')) + 16 : 0;
}

export const doneChipLabel = (count: number) => `済${count}`;
export const moreChipLabel = (count: number) => `+${count}`;
/** Resource CDs of folded chips, for the hover tip. */
export const chipCodes = (chips: readonly KioskResourceProgressProcessChip[]) => chips.map((chip) => chip.resourceCd).join(' ');

export type FittedChipStrip<T> = T & {
  line: number;
  width: number;
  /** Completed chips folded into one 「済N」 chip (empty = none shown). */
  done: KioskResourceProgressProcessChip[];
  shown: KioskResourceProgressProcessChip[];
  /** Chips that did not fit, shown as 「+N」. */
  hidden: KioskResourceProgressProcessChip[];
};

/** Fits as many chips as the room allows; anything left over becomes a 「+N」 chip. */
function fitChips(chips: readonly KioskResourceProgressProcessChip[], room: number, collapseDone: boolean, badgeWidth = 0) {
  const prefixWidth = badgeWidth ? badgeWidth + (chips.length ? CHIP_GAP : 0) : 0;
  room -= prefixWidth;
  const doneChips = collapseDone ? chips.filter((chip) => chip.isCompleted) : [];
  const doneCount = doneChips.length;
  const rest = collapseDone ? chips.filter((chip) => !chip.isCompleted) : [...chips];
  const tokens: { width: number; count: number; chip?: KioskResourceProgressProcessChip }[] = [...(doneCount ? [{ width: chipWidth(doneChipLabel(doneCount)), count: doneCount }] : []),
    ...rest.map((chip) => ({ width: chipWidth(chip.resourceCd), count: 1, chip }))];
  const total = tokens.reduce((sum, token) => sum + token.width, 0) + Math.max(0, tokens.length - 1) * CHIP_GAP;
  let take = tokens.length;
  if (total > room) {
    let used = 0;
    take = 0;
    for (const token of tokens) {
      const hiddenAfter = tokens.slice(take + 1).reduce((sum, rest) => sum + rest.count, 0);
      if (used + token.width + CHIP_GAP + (hiddenAfter ? chipWidth(moreChipLabel(hiddenAfter)) : 0) > room) break;
      used += token.width + CHIP_GAP;
      take += 1;
    }
  }
  const kept = tokens.slice(0, take);
  const hidden = tokens.slice(take).flatMap((token) => token.chip ? [token.chip] : doneChips);
  const width = kept.reduce((sum, token) => sum + token.width + CHIP_GAP, 0) + (hidden.length ? chipWidth(moreChipLabel(hidden.length)) : 0);
  return { done: kept.some((token) => !token.chip) ? doneChips : [], shown: kept.flatMap((token) => token.chip ? [token.chip] : []), hidden, width: width + prefixWidth };
}

/**
 * Lays chip strips out left to right without overlaps: a strip takes the first free line; when every allowed line is busy it goes
 * on the line whose last strip started earliest, and that strip is cut back with 「+N」 to make room.
 */
export function layoutChipStrips<T extends { left: number; chips: readonly KioskResourceProgressProcessChip[]; badgeWidth?: number }>(
  strips: readonly T[], fit: ChipStripFit
): { strips: FittedChipStrip<T>[]; lines: number } {
  const placed: FittedChipStrip<T>[] = [];
  const lastOnLine: FittedChipStrip<T>[] = [];
  for (const strip of [...strips].sort((a, b) => a.left - b.left)) {
    let line = lastOnLine.findIndex((last) => last.left + last.width + STRIP_GAP <= strip.left);
    if (line < 0 && lastOnLine.length < fit.maxLines) line = lastOnLine.length;
    if (line < 0) {
      line = lastOnLine.reduce((best, last, index) => last.left < lastOnLine[best]!.left ? index : best, 0);
      const previous = lastOnLine[line]!;
      Object.assign(previous, fitChips(previous.chips, strip.left - STRIP_GAP - previous.left, fit.collapseDone, previous.badgeWidth));
    }
    // If even the badge and +N cannot fit, move the next strip right instead of overlapping.
    const previous = lastOnLine[line];
    const left = previous ? Math.max(strip.left, previous.left + previous.width + STRIP_GAP) : strip.left;
    const next = { ...strip, left, line, ...fitChips(strip.chips, Number.POSITIVE_INFINITY, fit.collapseDone, strip.badgeWidth) };
    placed.push(next);
    lastOnLine[line] = next;
  }
  return { strips: placed, lines: lastOnLine.length };
}
