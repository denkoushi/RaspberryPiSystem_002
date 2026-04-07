import type { KioskProgressOverviewGridSlot } from '../kiosk-progress-overview/kiosk-progress-overview-layout.js';
import {
  PO_SIGNAGE_CARD_BG,
  PO_SIGNAGE_CARD_BORDER,
  PO_SIGNAGE_TEXT_MUTED,
  PO_SIGNAGE_TEXT_PRIMARY,
} from '../kiosk-progress-overview/progress-overview-signage-theme.js';
import type { LeaderOrderCardViewModel } from './leader-order-cards-data.service.js';
import type { LeaderOrderSignageSvgMetrics } from './leader-order-cards-svg-metrics.js';
import {
  LEADER_ORDER_SVG_ACCENT_AUTO,
  LEADER_ORDER_SVG_ACCENT_COMPLETED,
  LEADER_ORDER_SVG_ACCENT_MANUAL,
  LEADER_ORDER_SVG_DUE_AUTO,
  LEADER_ORDER_SVG_DUE_MANUAL,
  LEADER_ORDER_SVG_HEADER_BG,
  LEADER_ORDER_SVG_ROW_BG,
  LEADER_ORDER_SVG_ROW_BORDER,
} from './leader-order-cards-svg-theme.js';
import { escapeXmlForSvg, truncateChars } from './leader-order-cards-svg-text.js';

/**
 * 1資源分のカード SVG 断片（スロット矩形に収まるグループ）。
 */
export function buildLeaderOrderResourceCardSvgFragment(
  card: LeaderOrderCardViewModel,
  slot: KioskProgressOverviewGridSlot,
  m: LeaderOrderSignageSvgMetrics
): string {
  const { scale, cardPad, headerH, titleFs, subFs, bodyFs, smallFs, radius, rowGapInside } = m;
  const { x0, y0, cardW, cardH } = slot;

  const innerW = cardW - 2 * cardPad;
  const jp = card.resourceJapaneseNames.trim();
  const titleMaxChars = Math.max(6, Math.min(22, Math.floor(innerW / (titleFs * 0.52))));
  const subMaxChars = Math.max(12, Math.min(48, Math.floor(innerW * 0.11)));
  const titleLine = escapeXmlForSvg(truncateChars(card.resourceCd, titleMaxChars));
  const subLine = jp.length > 0 ? escapeXmlForSvg(truncateChars(jp, subMaxChars)) : '';
  const badgeWCap = Math.min(Math.round(72 * scale), Math.max(Math.round(44 * scale), Math.floor(innerW * 0.34)));

  const bodyTop = y0 + cardPad + headerH;
  const bodyHeightAvailable = cardH - 2 * cardPad - headerH - Math.round(8 * scale);
  const minRowH = Math.max(34, Math.round(44 * scale));
  const maxRowH = Math.max(minRowH, Math.round(62 * scale));
  const maxVisibleRows = Math.max(1, Math.floor((bodyHeightAvailable + rowGapInside) / (minRowH + rowGapInside)));
  const visibleRows = card.rows.slice(0, maxVisibleRows);
  const overflowCount = Math.max(0, card.rows.length - visibleRows.length);
  const rowBlockH =
    visibleRows.length > 0
      ? Math.min(
          maxRowH,
          Math.max(
            minRowH,
            Math.floor(
              (bodyHeightAvailable - rowGapInside * Math.max(0, visibleRows.length - 1)) / visibleRows.length
            )
          )
        )
      : minRowH;

  const rowBlocks = visibleRows
    .map((row, ri) => {
      const yRow = bodyTop + ri * (rowBlockH + rowGapInside);
      const op = row.isCompleted ? ' opacity="0.52"' : '';
      const dueColor = row.isCompleted
        ? LEADER_ORDER_SVG_ACCENT_COMPLETED
        : row.manualDue
          ? LEADER_ORDER_SVG_DUE_MANUAL
          : LEADER_ORDER_SVG_DUE_AUTO;
      const accentColor = row.isCompleted
        ? LEADER_ORDER_SVG_ACCENT_COMPLETED
        : row.manualDue
          ? LEADER_ORDER_SVG_ACCENT_MANUAL
          : LEADER_ORDER_SVG_ACCENT_AUTO;
      const rowTextBudget = Math.max(18, Math.floor(innerW - badgeWCap - Math.round(14 * scale)));
      const line1Max = Math.max(6, Math.min(24, Math.floor(rowTextBudget / (bodyFs * 0.55))));
      const line2Max = Math.max(10, Math.min(56, Math.floor(rowTextBudget / (smallFs * 0.52))));
      const line3Max = Math.max(10, Math.min(60, Math.floor(rowTextBudget / (smallFs * 0.52))));
      const line1 = escapeXmlForSvg(truncateChars(row.fkojun, line1Max));
      const lineDue = escapeXmlForSvg(truncateChars(row.dueLabel, 14));
      const line2 = escapeXmlForSvg(truncateChars(row.machinePartLine, line2Max));
      const line3 = escapeXmlForSvg(truncateChars(row.partNameLine, line3Max));
      const qty =
        row.quantityInlineJa != null
          ? ` <tspan fill="${PO_SIGNAGE_TEXT_MUTED}" font-size="${smallFs}">| ${escapeXmlForSvg(row.quantityInlineJa)}</tspan>`
          : '';
      const badgeW = badgeWCap;
      const badgeH = Math.round(18 * scale);
      const badgeX = x0 + cardPad + innerW - badgeW - Math.round(6 * scale);
      const badgeY = yRow + Math.round(6 * scale);

      return `<g${op}>
  <rect x="${x0 + cardPad}" y="${yRow}" width="${innerW}" height="${rowBlockH}" rx="${Math.round(6 * scale)}" fill="${LEADER_ORDER_SVG_ROW_BG}" stroke="${LEADER_ORDER_SVG_ROW_BORDER}" stroke-width="1"/>
  <rect x="${x0 + cardPad}" y="${yRow}" width="${Math.max(3, Math.round(4 * scale))}" height="${rowBlockH}" rx="${Math.max(
        1,
        Math.round(2 * scale)
      )}" fill="${accentColor}"/>
  <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${Math.round(9 * scale)}" fill="rgba(15,23,42,0.8)" stroke="${dueColor}" stroke-width="1"/>
  <text x="${badgeX + Math.round(8 * scale)}" y="${badgeY + Math.round(12 * scale)}" font-family="ui-monospace, monospace" font-size="${smallFs}" font-weight="700" fill="${dueColor}">${lineDue}</text>
  <text x="${x0 + cardPad + Math.round(10 * scale)}" y="${yRow + Math.round(15 * scale)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${bodyFs}" fill="${PO_SIGNAGE_TEXT_PRIMARY}">${line1}</text>
  <text x="${x0 + cardPad + Math.round(10 * scale)}" y="${yRow + Math.round(30 * scale)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${smallFs}" fill="${PO_SIGNAGE_TEXT_PRIMARY}">${line2}${qty}</text>
  <text x="${x0 + cardPad + Math.round(10 * scale)}" y="${yRow + Math.round(43 * scale)}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${smallFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">${line3}</text>
</g>`;
    })
    .join('\n');

  const emptyHint =
    card.rows.length === 0
      ? `<text x="${x0 + cardPad + Math.round(8 * scale)}" y="${bodyTop + Math.round(22 * scale)}" font-family="system-ui, sans-serif" font-size="${bodyFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">行なし</text>`
      : '';
  const overflowHint =
    overflowCount > 0
      ? `<text x="${x0 + cardPad + innerW - Math.round(8 * scale)}" y="${y0 + cardH - cardPad}" text-anchor="end" font-family="system-ui, sans-serif" font-size="${smallFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">+${overflowCount} 件</text>`
      : '';

  return `<g>
  <rect x="${x0}" y="${y0}" width="${cardW}" height="${cardH}" rx="${radius}" fill="${PO_SIGNAGE_CARD_BG}" stroke="${PO_SIGNAGE_CARD_BORDER}" stroke-width="1.5"/>
  <rect x="${x0 + 1}" y="${y0 + 1}" width="${cardW - 2}" height="${headerH}" rx="${Math.max(1, radius - Math.round(2 * scale))}" fill="${LEADER_ORDER_SVG_HEADER_BG}"/>
  <text x="${x0 + cardPad}" y="${y0 + cardPad + Math.round(18 * scale)}" font-family="ui-monospace, 'Cascadia Code', monospace" font-size="${titleFs}" font-weight="700" fill="${PO_SIGNAGE_TEXT_PRIMARY}">${titleLine}</text>
  ${
    subLine.length > 0
      ? `<text x="${x0 + cardPad}" y="${y0 + cardPad + Math.round(34 * scale)}" font-family="system-ui, sans-serif" font-size="${subFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">${subLine}</text>`
      : ''
  }
  ${emptyHint}
  ${rowBlocks}
  ${overflowHint}
</g>`;
}
