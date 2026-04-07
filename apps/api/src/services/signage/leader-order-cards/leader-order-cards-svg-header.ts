import {
  LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MIXED,
  LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MONO,
  LEADER_ORDER_SVG_HEADER_BASELINE_TITLE_FACTOR,
} from './leader-order-cards-svg-layout-tokens.js';
import { LEADER_ORDER_SVG_HEADER_JP } from './leader-order-cards-svg-theme.js';
import { escapeXmlForSvg, truncateChars } from './leader-order-cards-svg-text.js';

export type LeaderOrderHeaderTruncation = {
  titleMaxChars: number;
  jpMaxChars: number;
};

/**
 * 1行ヘッダに収める文字数（幅のヒューリスティック）。純関数・I/O なし。
 */
export function computeLeaderOrderHeaderTruncation(
  innerWidthPx: number,
  titleFs: number,
  subFs: number
): LeaderOrderHeaderTruncation {
  const titleMaxChars = Math.max(
    4,
    Math.min(14, Math.floor(innerWidthPx / (titleFs * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MONO)))
  );
  const titleApproxPx = titleFs * titleMaxChars * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MONO;
  const jpMaxChars = Math.max(
    8,
    Math.min(
      36,
      Math.floor(Math.max(0, innerWidthPx - titleApproxPx) / (subFs * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MIXED))
    )
  );
  return { titleMaxChars, jpMaxChars };
}

export type LeaderOrderCardHeaderSvgParams = {
  xCardLeft: number;
  yCardTop: number;
  cardPad: number;
  titleFs: number;
  subFs: number;
  innerWidthPx: number;
  resourceCd: string;
  resourceJapaneseNamesTrimmed: string;
  primaryFill: string;
};

/**
 * 資源CD + 日本語名を1行の `<text>` / `<tspan>` で出力（SVG 断片のみ）。
 */
export function buildLeaderOrderCardHeaderSvgFragment(p: LeaderOrderCardHeaderSvgParams): string {
  const { titleMaxChars, jpMaxChars } = computeLeaderOrderHeaderTruncation(p.innerWidthPx, p.titleFs, p.subFs);
  const titleLine = escapeXmlForSvg(truncateChars(p.resourceCd.trim(), titleMaxChars));
  const jp = p.resourceJapaneseNamesTrimmed;
  const jpTrunc = jp.length > 0 ? escapeXmlForSvg(truncateChars(jp, jpMaxChars)) : '';

  const headerTextY =
    p.yCardTop + p.cardPad + Math.round(p.titleFs * LEADER_ORDER_SVG_HEADER_BASELINE_TITLE_FACTOR);

  const jpTspan =
    jpTrunc.length > 0
      ? `<tspan font-size="${p.subFs}" font-weight="600" fill="${LEADER_ORDER_SVG_HEADER_JP}"> · ${jpTrunc}</tspan>`
      : '';

  return `<text x="${p.xCardLeft + p.cardPad}" y="${headerTextY}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="${p.titleFs}" fill="${p.primaryFill}"><tspan font-family="ui-monospace, 'Cascadia Code', monospace" font-weight="700" font-size="${p.titleFs}">${titleLine}</tspan>${jpTspan}</text>`;
}
