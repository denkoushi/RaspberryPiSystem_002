import type { LeaderboardPartFooterProcessItem } from '../../production-schedule/leaderboard/leaderboard-part-footer-processes.service.js';
import {
  PO_SIGNAGE_CHIP_DONE_BORDER,
  PO_SIGNAGE_CHIP_DONE_FILL,
  PO_SIGNAGE_CHIP_DONE_TEXT,
  PO_SIGNAGE_CHIP_TODO_BORDER,
  PO_SIGNAGE_CHIP_TODO_FILL,
  PO_SIGNAGE_CHIP_TODO_TEXT,
} from '../kiosk-progress-overview/progress-overview-signage-theme.js';
import { escapeXmlForSvg, truncateChars } from './leader-order-cards-svg-text.js';

export type LeaderOrderFooterChipsLayout = {
  x: number;
  y: number;
  maxWidth: number;
  chipFs: number;
  scale: number;
};

/**
 * 行下辺の資源進捗チップ（キオスク `KioskResourceProcessChips` 相当）。
 */
export function buildLeaderOrderFooterChipsSvgFragment(
  chips: readonly LeaderboardPartFooterProcessItem[],
  L: LeaderOrderFooterChipsLayout
): string {
  if (chips.length === 0) return '';

  const chipH = Math.max(Math.round(14 * L.scale), L.chipFs + Math.round(6 * L.scale));
  const chipPadX = Math.round(4 * L.scale);
  const gap = Math.round(4 * L.scale);
  const borderY = L.y;
  const chipsY = L.y + Math.round(5 * L.scale);
  let x = L.x;

  const chipRects: string[] = [];
  for (const chip of chips) {
    const label = escapeXmlForSvg(truncateChars(chip.resourceCd.trim(), 8));
    const approxW = Math.max(Math.round(22 * L.scale), Math.round(label.length * L.chipFs * 0.62) + chipPadX * 2);
    if (x + approxW > L.x + L.maxWidth) break;

    const done = chip.isCompleted;
    const stroke = done ? PO_SIGNAGE_CHIP_DONE_BORDER : PO_SIGNAGE_CHIP_TODO_BORDER;
    const fill = done ? PO_SIGNAGE_CHIP_DONE_FILL : PO_SIGNAGE_CHIP_TODO_FILL;
    const textFill = done ? PO_SIGNAGE_CHIP_DONE_TEXT : PO_SIGNAGE_CHIP_TODO_TEXT;
    const op = done ? ' opacity="0.5"' : '';

    chipRects.push(`<g${op}>
  <rect x="${x}" y="${chipsY}" width="${approxW}" height="${chipH}" rx="${Math.round(4 * L.scale)}" fill="${fill}" stroke="${stroke}" stroke-width="1"/>
  <text x="${x + chipPadX}" y="${chipsY + Math.round(chipH * 0.72)}" font-family="ui-monospace, monospace" font-size="${L.chipFs}" fill="${textFill}">${label}</text>
</g>`);
    x += approxW + gap;
  }

  if (chipRects.length === 0) return '';

  return `<line x1="${L.x}" y1="${borderY}" x2="${L.x + L.maxWidth}" y2="${borderY}" stroke="rgba(255,255,255,0.1)" stroke-width="1"/>
${chipRects.join('\n')}`;
}
