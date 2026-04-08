import {
  PO_SIGNAGE_TEXT_MUTED,
  PO_SIGNAGE_TEXT_PRIMARY,
} from '../kiosk-progress-overview/progress-overview-signage-theme.js';
import type { SignageLeaderOrderSvgRow } from './leader-board-pure.js';
import {
  LEADER_ORDER_SVG_AVG_CHAR_WIDTH_BODY,
  LEADER_ORDER_SVG_AVG_CHAR_WIDTH_SMALL,
  LEADER_ORDER_SVG_BADGE_STROKE_WIDTH,
  LEADER_ORDER_SVG_ROW_ACCENT_BAR_WIDTH_SCALE,
  LEADER_ORDER_SVG_ROW_STROKE_WIDTH,
} from './leader-order-cards-svg-layout-tokens.js';
import {
  LEADER_ORDER_SVG_ACCENT_AUTO,
  LEADER_ORDER_SVG_ACCENT_COMPLETED,
  LEADER_ORDER_SVG_ACCENT_MANUAL,
  LEADER_ORDER_SVG_BADGE_FILL,
  LEADER_ORDER_SVG_DUE_AUTO,
  LEADER_ORDER_SVG_DUE_MANUAL,
  LEADER_ORDER_SVG_ROW_BG,
  LEADER_ORDER_SVG_ROW_BORDER,
  LEADER_ORDER_SVG_ROW_LINE3_FILL,
} from './leader-order-cards-svg-theme.js';
import { escapeXmlForSvg, truncateChars } from './leader-order-cards-svg-text.js';

export type LeaderOrderScheduleRowLayout = {
  contentLeft: number;
  innerWidth: number;
  yRow: number;
  rowBlockHeight: number;
  scale: number;
  bodyFs: number;
  smallFs: number;
  badgeWidthCap: number;
};

function resolveRowAccentColors(row: SignageLeaderOrderSvgRow): {
  duePillStroke: string;
  accentBarFill: string;
} {
  if (row.isCompleted) {
    return { duePillStroke: LEADER_ORDER_SVG_ACCENT_COMPLETED, accentBarFill: LEADER_ORDER_SVG_ACCENT_COMPLETED };
  }
  if (row.manualDue) {
    return { duePillStroke: LEADER_ORDER_SVG_DUE_MANUAL, accentBarFill: LEADER_ORDER_SVG_ACCENT_MANUAL };
  }
  return { duePillStroke: LEADER_ORDER_SVG_DUE_AUTO, accentBarFill: LEADER_ORDER_SVG_ACCENT_AUTO };
}

/**
 * 1製番行ブロックの SVG（順位ボード資源カード本文用）。
 */
export function buildLeaderOrderScheduleRowSvgFragment(
  row: SignageLeaderOrderSvgRow,
  L: LeaderOrderScheduleRowLayout
): string {
  const { duePillStroke, accentBarFill } = resolveRowAccentColors(row);
  const op = row.isCompleted ? ' opacity="0.52"' : '';

  const rowTextBudget = Math.max(18, Math.floor(L.innerWidth - L.badgeWidthCap - Math.round(14 * L.scale)));
  const line1Max = Math.max(
    6,
    Math.min(24, Math.floor(rowTextBudget / (L.bodyFs * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_BODY)))
  );
  const line2Max = Math.max(
    10,
    Math.min(56, Math.floor(rowTextBudget / (L.smallFs * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_SMALL)))
  );
  const line3Max = Math.max(
    10,
    Math.min(60, Math.floor(rowTextBudget / (L.smallFs * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_SMALL)))
  );
  const line1 = escapeXmlForSvg(truncateChars(row.fkojun, line1Max));
  const lineDue = escapeXmlForSvg(truncateChars(row.dueLabel, 14));
  const line2 = escapeXmlForSvg(truncateChars(row.machinePartLine, line2Max));
  const line3 = escapeXmlForSvg(truncateChars(row.partNameLine, line3Max));
  const qty =
    row.quantityInlineJa != null
      ? ` <tspan fill="${PO_SIGNAGE_TEXT_MUTED}" font-size="${L.smallFs}">| ${escapeXmlForSvg(row.quantityInlineJa)}</tspan>`
      : '';

  const badgeW = L.badgeWidthCap;
  const badgeH = Math.max(Math.round(26 * L.scale), L.smallFs + Math.round(10 * L.scale));
  const badgeX = L.contentLeft + L.innerWidth - badgeW - Math.round(6 * L.scale);
  const badgeY = L.yRow + Math.round(8 * L.scale);
  const padL = Math.round(10 * L.scale);
  const t1 = L.yRow + Math.round(12 * L.scale) + Math.round(L.bodyFs * 0.72);
  const t2 = t1 + Math.round(L.bodyFs * 1.08);
  const t3 = t2 + Math.round(L.smallFs * 1.05);

  const rxRow = Math.round(6 * L.scale);

  return `<g${op}>
  <rect x="${L.contentLeft}" y="${L.yRow}" width="${L.innerWidth}" height="${
    L.rowBlockHeight
  }" rx="${rxRow}" fill="${LEADER_ORDER_SVG_ROW_BG}" stroke="${LEADER_ORDER_SVG_ROW_BORDER}" stroke-width="${LEADER_ORDER_SVG_ROW_STROKE_WIDTH}"/>
  <rect x="${L.contentLeft}" y="${L.yRow}" width="${Math.max(4, Math.round(LEADER_ORDER_SVG_ROW_ACCENT_BAR_WIDTH_SCALE * L.scale))}" height="${
    L.rowBlockHeight
  }" rx="${Math.max(1, Math.round(2 * L.scale))}" fill="${accentBarFill}"/>
  <rect x="${badgeX}" y="${badgeY}" width="${badgeW}" height="${badgeH}" rx="${Math.round(
    9 * L.scale
  )}" fill="${LEADER_ORDER_SVG_BADGE_FILL}" stroke="${duePillStroke}" stroke-width="${LEADER_ORDER_SVG_BADGE_STROKE_WIDTH}"/>
  <text x="${badgeX + Math.round(8 * L.scale)}" y="${badgeY + Math.round(badgeH * 0.72)}" font-family="ui-monospace, monospace" font-size="${
    L.smallFs
  }" font-weight="700" fill="${duePillStroke}">${lineDue}</text>
  <text x="${L.contentLeft + padL}" y="${t1}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${
    L.bodyFs
  }" font-weight="600" fill="${PO_SIGNAGE_TEXT_PRIMARY}">${line1}</text>
  <text x="${L.contentLeft + padL}" y="${t2}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${
    L.smallFs
  }" font-weight="500" fill="${PO_SIGNAGE_TEXT_PRIMARY}">${line2}${qty}</text>
  <text x="${L.contentLeft + padL}" y="${t3}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${
    L.smallFs
  }" fill="${LEADER_ORDER_SVG_ROW_LINE3_FILL}">${line3}</text>
</g>`;
}
