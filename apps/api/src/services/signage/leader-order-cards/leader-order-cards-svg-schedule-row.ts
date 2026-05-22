import { PO_SIGNAGE_TEXT_MUTED } from '../kiosk-progress-overview/progress-overview-signage-theme.js';
import type { SignageLeaderOrderSvgRow } from './leader-board-pure.js';
import { buildLeaderOrderFooterChipsSvgFragment } from './leader-order-cards-svg-footer-chips.js';
import {
  LEADER_ORDER_SVG_AVG_CHAR_WIDTH_SMALL,
  LEADER_ORDER_SVG_ROW_SEIBAN_ACCENT_WIDTH_SCALE,
  LEADER_ORDER_SVG_ROW_STROKE_WIDTH,
} from './leader-order-cards-svg-layout-tokens.js';
import {
  LEADER_ORDER_SVG_DUE_AUTO,
  LEADER_ORDER_SVG_DUE_MANUAL,
  LEADER_ORDER_SVG_ROW_BG,
  LEADER_ORDER_SVG_ROW_BG_RANKED,
  LEADER_ORDER_SVG_ROW_BORDER,
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
};

function buildClusterTspans(segments: string[], quantityInlineJa: string | null): string {
  const parts: string[] = [];
  segments.forEach((seg, i) => {
    if (i > 0) {
      parts.push(`<tspan fill="${PO_SIGNAGE_TEXT_MUTED}"> · </tspan>`);
    }
    parts.push(`<tspan>${escapeXmlForSvg(truncateChars(seg, 24))}</tspan>`);
  });
  if (quantityInlineJa) {
    if (segments.length > 0) {
      parts.push(`<tspan fill="${PO_SIGNAGE_TEXT_MUTED}"> · </tspan>`);
    }
    parts.push(`<tspan>${escapeXmlForSvg(quantityInlineJa)}</tspan>`);
  }
  return parts.join('');
}

/** 行ブロックの縦寸法見積もり（カード内の可視行数計算用）。 */
export function estimateLeaderOrderScheduleRowHeightPx(
  row: SignageLeaderOrderSvgRow,
  scale: number,
  bodyFs: number,
  smallFs: number
): number {
  const padY = Math.round(6 * scale);
  let h = padY + Math.round(smallFs * 1.12);
  if (row.clusterSegments.length === 0 && !row.quantityInlineJa) {
    h = padY + Math.round(bodyFs * 1.05);
  }
  if (row.partNameLine.length > 0) {
    h += Math.round(smallFs * 1.1);
  }
  if (row.machineTypeNameLine.length > 0) {
    h += Math.round(smallFs * 1.1);
  }
  if (row.footerChips.length > 0) {
    h += Math.round(smallFs + 18 * scale);
  }
  return h + padY;
}

/**
 * 1製番行ブロックの SVG（キオスク順位ボード子行レイアウト準拠・閲覧専用）。
 */
export function buildLeaderOrderScheduleRowSvgFragment(
  row: SignageLeaderOrderSvgRow,
  L: LeaderOrderScheduleRowLayout
): string {
  const accentW = Math.max(4, Math.round(LEADER_ORDER_SVG_ROW_SEIBAN_ACCENT_WIDTH_SCALE * L.scale));
  const contentInset = accentW + Math.round(6 * L.scale);
  const textLeft = L.contentLeft + contentInset;
  const textRight = L.contentLeft + L.innerWidth - Math.round(6 * L.scale);
  const textW = Math.max(12, textRight - textLeft);

  const dueFill = row.manualDue ? LEADER_ORDER_SVG_DUE_MANUAL : LEADER_ORDER_SVG_DUE_AUTO;
  const dueWeight = row.manualDue ? '500' : '400';
  const op = row.isCompleted ? ' opacity="0.52"' : '';
  const accentFill = row.seibanAccentHex ?? 'transparent';

  const lineDue = escapeXmlForSvg(truncateChars(row.dueLabel, 14));
  const clusterInner = buildClusterTspans(row.clusterSegments, row.quantityInlineJa);
  const linePart =
    row.partNameLine.length > 0
      ? escapeXmlForSvg(truncateChars(row.partNameLine, Math.floor(textW / (L.smallFs * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_SMALL))))
      : '';
  const lineMachine =
    row.machineTypeNameLine.length > 0
      ? escapeXmlForSvg(truncateChars(row.machineTypeNameLine, Math.floor(textW / (L.smallFs * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_SMALL))))
      : '';

  const padTop = Math.round(4 * L.scale);
  let y = L.yRow + padTop + Math.round(L.smallFs * 0.85);
  const rxRow = Math.round(4 * L.scale);
  const rowBg = row.hasManualOrder ? LEADER_ORDER_SVG_ROW_BG_RANKED : LEADER_ORDER_SVG_ROW_BG;

  const clusterLine =
    clusterInner.length > 0
      ? `<text x="${textLeft}" y="${y}" font-family="system-ui, sans-serif" font-size="${L.smallFs}" fill="rgba(255,255,255,0.8)">${clusterInner}</text>`
      : '';
  const dueLine = `<text x="${textRight}" y="${y}" text-anchor="end" font-family="ui-monospace, monospace" font-size="${Math.round(L.smallFs * 0.95)}" font-weight="${dueWeight}" fill="${dueFill}">${lineDue}</text>`;
  y += Math.round(L.smallFs * 1.1);

  const partLine =
    linePart.length > 0
      ? `<text x="${textLeft}" y="${y}" font-family="system-ui, sans-serif" font-size="${L.smallFs}" fill="rgba(255,255,255,0.6)">${linePart}</text>`
      : '';
  if (linePart.length > 0) y += Math.round(L.smallFs * 1.08);

  const machineLine =
    lineMachine.length > 0
      ? `<text x="${textLeft}" y="${y}" font-family="system-ui, sans-serif" font-size="${L.smallFs}" fill="rgba(255,255,255,0.8)">${lineMachine}</text>`
      : '';
  if (lineMachine.length > 0) y += Math.round(L.smallFs * 1.05);

  const chipFs = Math.max(9, Math.round(L.smallFs * 0.92));
  const footerSvg = buildLeaderOrderFooterChipsSvgFragment(row.footerChips, {
    x: textLeft,
    y: y + Math.round(4 * L.scale),
    maxWidth: textW,
    chipFs,
    scale: L.scale,
  });

  const accentRect =
    row.seibanAccentHex != null
      ? `<rect x="${L.contentLeft}" y="${L.yRow}" width="${accentW}" height="${L.rowBlockHeight}" rx="${Math.max(1, rxRow - 1)}" fill="${accentFill}"/>`
      : '';

  return `<g${op}>
  <rect x="${L.contentLeft}" y="${L.yRow}" width="${L.innerWidth}" height="${L.rowBlockHeight}" rx="${rxRow}" fill="${rowBg}" stroke="${LEADER_ORDER_SVG_ROW_BORDER}" stroke-width="${LEADER_ORDER_SVG_ROW_STROKE_WIDTH}"/>
  ${accentRect}
  ${clusterLine}
  ${dueLine}
  ${partLine}
  ${machineLine}
  ${footerSvg}
</g>`;
}
