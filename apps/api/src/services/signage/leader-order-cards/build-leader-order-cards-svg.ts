import { computeKioskProgressOverviewGridSlots } from '../kiosk-progress-overview/kiosk-progress-overview-layout.js';
import {
  PO_SIGNAGE_CARD_BG,
  PO_SIGNAGE_CARD_BORDER,
  PO_SIGNAGE_TEXT_MUTED,
  PO_SIGNAGE_TEXT_PRIMARY,
} from '../kiosk-progress-overview/progress-overview-signage-theme.js';
import {
  LEADER_ORDER_SIGNAGE_GRID_COLUMNS,
  LEADER_ORDER_SIGNAGE_GRID_ROWS,
} from './layout-contracts.js';
import type { LeaderOrderCardViewModel } from './leader-order-cards-data.service.js';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return '…';
  }
  return `${value.slice(0, maxChars - 1)}…`;
}

const DUE_COLOR_MANUAL = '#fcd34d';
const DUE_COLOR_AUTO = '#7dd3fc';
const ROW_BG = 'rgba(30, 41, 59, 0.8)';
const ROW_BORDER = 'rgba(255, 255, 255, 0.08)';

/**
 * 順位ボード資源カードのサイネージ用 SVG（操作UIなし）。
 */
export function buildLeaderOrderCardsSvg(cards: LeaderOrderCardViewModel[], width: number, height: number): string {
  const scale = width / 1920;
  const outerPad = Math.round(12 * scale);
  const colGap = Math.round(10 * scale);
  const rowGap = Math.round(10 * scale);

  const gridSlots = computeKioskProgressOverviewGridSlots({
    width,
    height,
    columns: LEADER_ORDER_SIGNAGE_GRID_COLUMNS,
    rows: LEADER_ORDER_SIGNAGE_GRID_ROWS,
    outerPad,
    colGap,
    rowGap,
  });

  const cardPad = Math.round(10 * scale);
  const headerH = Math.round(38 * scale);
  const titleFs = Math.max(12, Math.round(15 * scale));
  const subFs = Math.max(9, Math.round(12 * scale));
  const bodyFs = Math.max(9, Math.round(11 * scale));
  const smallFs = Math.max(8, Math.round(10 * scale));
  const radius = Math.round(6 * scale);

  const cardsSvg = cards
    .map((card, slotIndex) => {
      const slot = gridSlots[slotIndex];
      if (!slot) {
        return '';
      }
      const { x0, y0, cardW, cardH } = slot;

      const innerW = cardW - 2 * cardPad;
      const jp = card.resourceJapaneseNames.trim();
      const titleLine = escapeXml(truncateChars(card.resourceCd, 24));
      const subLine = jp.length > 0 ? escapeXml(truncateChars(jp, 80)) : '';

      const bodyTop = y0 + cardPad + headerH;
      const bodyHeightAvailable = cardH - 2 * cardPad - headerH - Math.round(4 * scale);
      const maxRows = Math.max(1, card.rows.length);
      const rowBlockH = Math.min(
        Math.round(52 * scale),
        Math.max(Math.round(36 * scale), Math.floor(bodyHeightAvailable / maxRows))
      );

      const rowBlocks = card.rows
        .map((row, ri) => {
          const yRow = bodyTop + ri * rowBlockH;
          const op = row.isCompleted ? ' opacity="0.52"' : '';
          const dueColor = row.manualDue ? DUE_COLOR_MANUAL : DUE_COLOR_AUTO;
          const line1 = escapeXml(truncateChars(row.fkojun, 22));
          const lineDue = escapeXml(truncateChars(row.dueLabel, 14));
          const line2 = escapeXml(truncateChars(row.machinePartLine, 120));
          const line3 = escapeXml(truncateChars(row.partNameLine, 120));
          const qty =
            row.quantityInlineJa != null
              ? ` <tspan fill="${PO_SIGNAGE_TEXT_MUTED}" font-size="${smallFs}">· ${escapeXml(row.quantityInlineJa)}</tspan>`
              : '';

          return `<g${op}>
  <rect x="${x0 + cardPad}" y="${yRow}" width="${innerW}" height="${rowBlockH - Math.round(2 * scale)}" rx="${Math.round(4 * scale)}" fill="${ROW_BG}" stroke="${ROW_BORDER}" stroke-width="1"/>
  <text x="${x0 + cardPad + Math.round(6 * scale)}" y="${yRow + Math.round(14 * scale)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${bodyFs}" fill="${PO_SIGNAGE_TEXT_PRIMARY}">${line1}<tspan fill="${PO_SIGNAGE_TEXT_MUTED}">  </tspan><tspan fill="${dueColor}" font-weight="600" font-family="ui-monospace, monospace">${lineDue}</tspan></text>
  <text x="${x0 + cardPad + Math.round(6 * scale)}" y="${yRow + Math.round(28 * scale)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${smallFs}" fill="${PO_SIGNAGE_TEXT_PRIMARY}">${line2}${qty}</text>
  <text x="${x0 + cardPad + Math.round(6 * scale)}" y="${yRow + Math.round(40 * scale)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${smallFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">${line3}</text>
</g>`;
        })
        .join('\n');

      const emptyHint =
        card.rows.length === 0
          ? `<text x="${x0 + cardPad + Math.round(6 * scale)}" y="${bodyTop + Math.round(20 * scale)}" font-family="system-ui, sans-serif" font-size="${bodyFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">行なし</text>`
          : '';

      return `<g>
  <rect x="${x0}" y="${y0}" width="${cardW}" height="${cardH}" rx="${radius}" fill="${PO_SIGNAGE_CARD_BG}" stroke="${PO_SIGNAGE_CARD_BORDER}" stroke-width="1.5"/>
  <text x="${x0 + cardPad}" y="${y0 + cardPad + Math.round(18 * scale)}" font-family="ui-monospace, 'Cascadia Code', monospace" font-size="${titleFs}" font-weight="600" fill="${PO_SIGNAGE_TEXT_PRIMARY}">${titleLine}</text>
  ${
    subLine.length > 0
      ? `<text x="${x0 + cardPad}" y="${y0 + cardPad + Math.round(34 * scale)}" font-family="system-ui, sans-serif" font-size="${subFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">${subLine}</text>`
      : ''
  }
  ${emptyHint}
  ${rowBlocks}
</g>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#020617"/>
  ${cardsSvg}
</svg>`;
}
