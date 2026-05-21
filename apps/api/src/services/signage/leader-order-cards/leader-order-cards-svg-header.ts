import {
  LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MONO,
  LEADER_ORDER_SVG_HEADER_BASELINE_TITLE_FACTOR,
} from './leader-order-cards-svg-layout-tokens.js';
import { escapeXmlForSvg } from './leader-order-cards-svg-text.js';

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
 * 資源CD（mono）+ 加工機名（日本語）を **1行・省略なし** で横並び。
 * キオスク `LeaderOrderResourceCard` ヘッダ相当（`flex-wrap` なし・折り返しなし）。
 */
export function buildLeaderOrderCardHeaderSvgFragment(p: LeaderOrderCardHeaderSvgParams): string {
  const cd = escapeXmlForSvg(p.resourceCd.trim());
  const jp = p.resourceJapaneseNamesTrimmed.trim();

  const headerTextY =
    p.yCardTop + p.cardPad + Math.round(p.titleFs * LEADER_ORDER_SVG_HEADER_BASELINE_TITLE_FACTOR);

  const xCd = p.xCardLeft + p.cardPad;

  if (!jp) {
    return `<text x="${xCd}" y="${headerTextY}" font-family="ui-monospace, monospace" font-size="${p.titleFs}" font-weight="500" fill="rgba(255,255,255,0.95)">${cd}</text>`;
  }

  const cdApproxW = p.titleFs * cd.length * LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MONO;
  const xJp = xCd + Math.round(cdApproxW + 8);
  const jpEscaped = escapeXmlForSvg(jp);

  return `<text x="${xCd}" y="${headerTextY}" font-family="ui-monospace, monospace" font-size="${p.titleFs}" font-weight="500" fill="rgba(255,255,255,0.95)">${cd}</text>
<text x="${xJp}" y="${headerTextY}" font-family="system-ui, sans-serif" font-size="${p.subFs}" font-weight="500" fill="rgba(255,255,255,0.78)">${jpEscaped}</text>`;
}
