import type { KioskProgressOverviewGridSlot } from '../kiosk-progress-overview/kiosk-progress-overview-layout.js';
import { PO_SIGNAGE_TEXT_MUTED } from '../kiosk-progress-overview/progress-overview-signage-theme.js';
import type { LeaderOrderCardViewModel } from './leader-order-cards-data.service.js';
import { buildLeaderOrderCardHeaderSvgFragment } from './leader-order-cards-svg-header.js';
import { LEADER_ORDER_SVG_CARD_OUTER_STROKE_WIDTH } from './leader-order-cards-svg-layout-tokens.js';
import type { LeaderOrderSignageSvgMetrics } from './leader-order-cards-svg-metrics.js';
import {
  buildLeaderOrderScheduleRowSvgFragment,
  estimateLeaderOrderScheduleRowHeightPx,
} from './leader-order-cards-svg-schedule-row.js';
import { LEADER_ORDER_SVG_CARD_BG, LEADER_ORDER_SVG_CARD_BORDER } from './leader-order-cards-svg-theme.js';

function layoutVisibleRows(
  rows: LeaderOrderCardViewModel['rows'],
  bodyTop: number,
  bodyHeightAvailable: number,
  scale: number,
  bodyFs: number,
  smallFs: number,
  rowGapInside: number
): { visible: LeaderOrderCardViewModel['rows']; overflowCount: number; layouts: Array<{ y: number; h: number }> } {
  const layouts: Array<{ y: number; h: number }> = [];
  let y = bodyTop;
  const visible: LeaderOrderCardViewModel['rows'] = [];

  for (const row of rows) {
    const h = estimateLeaderOrderScheduleRowHeightPx(row, scale, bodyFs, smallFs);
    const need = h + (visible.length > 0 ? rowGapInside : 0);
    if (y + need > bodyTop + bodyHeightAvailable && visible.length > 0) {
      break;
    }
    if (visible.length > 0) {
      y += rowGapInside;
    }
    layouts.push({ y, h });
    visible.push(row);
    y += h;
  }

  return {
    visible,
    overflowCount: Math.max(0, rows.length - visible.length),
    layouts,
  };
}

/**
 * 1資源分のカード SVG（枠・ヘッダ・行ブロックの組み立てのみ）。
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

  const bodyTop = y0 + cardPad + headerH;
  const bodyHeightAvailable = cardH - 2 * cardPad - headerH - Math.round(8 * scale);

  const { visible, overflowCount, layouts } = layoutVisibleRows(
    card.rows,
    bodyTop,
    bodyHeightAvailable,
    scale,
    bodyFs,
    smallFs,
    rowGapInside
  );

  const contentLeft = x0 + cardPad;
  const rowBlocks = visible
    .map((row, ri) => {
      const layout = layouts[ri];
      if (!layout) return '';
      return buildLeaderOrderScheduleRowSvgFragment(row, {
        contentLeft,
        innerWidth: innerW,
        yRow: layout.y,
        rowBlockHeight: layout.h,
        scale,
        bodyFs,
        smallFs,
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
  <rect x="${x0}" y="${y0}" width="${cardW}" height="${cardH}" rx="${radius}" fill="${LEADER_ORDER_SVG_CARD_BG}" stroke="${LEADER_ORDER_SVG_CARD_BORDER}" stroke-width="${LEADER_ORDER_SVG_CARD_OUTER_STROKE_WIDTH}"/>
  ${headerBlock}
  ${emptyHint}
  ${rowBlocks}
  ${overflowHint}
</g>`;
}
