import type { KioskProgressOverviewGridSlot } from '../kiosk-progress-overview/kiosk-progress-overview-layout.js';
import {
  PO_SIGNAGE_CARD_BG,
  PO_SIGNAGE_CARD_BORDER,
  PO_SIGNAGE_TEXT_MUTED,
  PO_SIGNAGE_TEXT_PRIMARY,
} from '../kiosk-progress-overview/progress-overview-signage-theme.js';
import type { LeaderOrderCardViewModel } from './leader-order-cards-data.service.js';
import { buildLeaderOrderCardHeaderSvgFragment } from './leader-order-cards-svg-header.js';
import {
  LEADER_ORDER_SVG_CARD_OUTER_STROKE_WIDTH,
  LEADER_ORDER_SVG_HEADER_REGION_STROKE_WIDTH,
} from './leader-order-cards-svg-layout-tokens.js';
import type { LeaderOrderSignageSvgMetrics } from './leader-order-cards-svg-metrics.js';
import { buildLeaderOrderScheduleRowSvgFragment } from './leader-order-cards-svg-schedule-row.js';
import { LEADER_ORDER_SVG_HEADER_BG, LEADER_ORDER_SVG_HEADER_BAND_STROKE } from './leader-order-cards-svg-theme.js';

/**
 * 1資源分のカード SVG（枠・ヘッダ・行ブロックの組み立てのみ）。
 * ヘッダ・1行の幾何は専用モジュールへ分離（単一責任・再利用・調整箇所の限定）。
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
  const badgeWCap = Math.min(Math.round(72 * scale), Math.max(Math.round(44 * scale), Math.floor(innerW * 0.34)));

  const bodyTop = y0 + cardPad + headerH;
  const bodyHeightAvailable = cardH - 2 * cardPad - headerH - Math.round(8 * scale);
  const minRowH = Math.max(52, Math.round(72 * scale));
  const maxRowH = Math.max(minRowH, Math.round(98 * scale));
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

  const contentLeft = x0 + cardPad;
  const rowBlocks = visibleRows
    .map((row, ri) => {
      const yRow = bodyTop + ri * (rowBlockH + rowGapInside);
      return buildLeaderOrderScheduleRowSvgFragment(row, {
        contentLeft,
        innerWidth: innerW,
        yRow,
        rowBlockHeight: rowBlockH,
        scale,
        bodyFs,
        smallFs,
        badgeWidthCap: badgeWCap,
      });
    })
    .join('\n');

  const headerBlock = buildLeaderOrderCardHeaderSvgFragment({
    xCardLeft: x0,
    yCardTop: y0,
    cardPad,
    titleFs,
    subFs,
    innerWidthPx: innerW,
    resourceCd: card.resourceCd,
    resourceJapaneseNamesTrimmed: jp,
    primaryFill: PO_SIGNAGE_TEXT_PRIMARY,
  });

  const emptyHint =
    card.rows.length === 0
      ? `<text x="${contentLeft + Math.round(8 * scale)}" y="${bodyTop + Math.round(bodyFs + 12 * scale)}" font-family="system-ui, sans-serif" font-size="${bodyFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">行なし</text>`
      : '';
  const overflowHint =
    overflowCount > 0
      ? `<text x="${contentLeft + innerW - Math.round(8 * scale)}" y="${y0 + cardH - cardPad}" text-anchor="end" font-family="system-ui, sans-serif" font-size="${smallFs}" fill="${PO_SIGNAGE_TEXT_MUTED}">+${overflowCount} 件</text>`
      : '';

  return `<g>
  <rect x="${x0}" y="${y0}" width="${cardW}" height="${cardH}" rx="${radius}" fill="${PO_SIGNAGE_CARD_BG}" stroke="${PO_SIGNAGE_CARD_BORDER}" stroke-width="${LEADER_ORDER_SVG_CARD_OUTER_STROKE_WIDTH}"/>
  <rect x="${x0 + 1}" y="${y0 + 1}" width="${cardW - 2}" height="${headerH}" rx="${Math.max(1, radius - Math.round(2 * scale))}" fill="${LEADER_ORDER_SVG_HEADER_BG}" stroke="${LEADER_ORDER_SVG_HEADER_BAND_STROKE}" stroke-width="${LEADER_ORDER_SVG_HEADER_REGION_STROKE_WIDTH}"/>
  ${headerBlock}
  ${emptyHint}
  ${rowBlocks}
  ${overflowHint}
</g>`;
}
