import {
  LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MIXED,
  LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MONO,
  LEADER_ORDER_SVG_HEADER_BASELINE_TITLE_FACTOR,
} from './leader-order-cards-svg-layout-tokens.js';
import { escapeXmlForSvg, truncateChars } from './leader-order-cards-svg-text.js';

export type LeaderOrderHeaderTruncation = {
  titleMaxChars: number;
  jpMaxChars: number;
};

/**
 * ヘッダ行に収める文字数（幅のヒューリスティック）。純関数・I/O なし。
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
  const jpBudget = Math.max(0, innerWidthPx - titleApproxPx - Math.round(8));
  const jpMaxChars = Math.max(
    0,
    Math.min(36, Math.floor(jpBudget / (subFs * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MIXED)))
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
};

/**
 * 資源CD（mono）+ 日本語名を横並び（キオスク `LeaderOrderResourceCard` ヘッダ相当）。
 */
export function buildLeaderOrderCardHeaderSvgFragment(p: LeaderOrderCardHeaderSvgParams): string {
  const { titleMaxChars, jpMaxChars } = computeLeaderOrderHeaderTruncation(p.innerWidthPx, p.titleFs, p.subFs);
  const titleLine = escapeXmlForSvg(truncateChars(p.resourceCd.trim(), titleMaxChars));
  const jp = p.resourceJapaneseNamesTrimmed;
  const jpTrunc = jp.length > 0 && jpMaxChars > 0 ? escapeXmlForSvg(truncateChars(jp, jpMaxChars)) : '';

  const headerTextY =
    p.yCardTop + p.cardPad + Math.round(p.titleFs * LEADER_ORDER_SVG_HEADER_BASELINE_TITLE_FACTOR);

  const xCd = p.xCardLeft + p.cardPad;
  const cdApproxW = p.titleFs * titleLine.length * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MONO;
  const xJp = xCd + Math.round(cdApproxW + 8);

  const jpText =
    jpTrunc.length > 0
      ? `<text x="${xJp}" y="${headerTextY}" font-family="system-ui, sans-serif" font-size="${p.subFs}" font-weight="500" fill="rgba(255,255,255,0.78)">${jpTrunc}</text>`
      : '';

  return `<text x="${xCd}" y="${headerTextY}" font-family="ui-monospace, monospace" font-size="${p.titleFs}" font-weight="500" fill="rgba(255,255,255,0.95)">${titleLine}</text>
${jpText}`;
}
