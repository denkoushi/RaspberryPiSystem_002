import type { Md3Tokens } from '../_design-system/md3.js';
import { escapeSvgText } from '../_design-system/index.js';
import type { MiBodyLine } from './mi-instrument-display.types.js';
import {
  MI_CARD_CORNER_RADIUS_PX,
  MI_CARD_INNER_PAD_PX,
  MI_HEADER_BAND_END_YPX,
  MI_NAME_HEADER_BASELINE_YPX,
  MI_NAMES_START_YPX,
} from './mi-instrument-card-metrics.js';
import type { MiCardChrome } from './mi-instrument-card-palette.js';
import { resolveBodyFill } from './mi-inspection-body-fill.js';

function escapeXml(value: string): string {
  return escapeSvgText(value);
}

/**
 * 上辺のみ角丸の帯パス（下辺は直線）。HTML の .mi-card__band 相当。
 */
function buildTopRoundedBarPathD(x: number, y: number, w: number, h: number, rx: number, ry: number): string {
  const r = Math.min(rx, ry, w / 2, h / 2);
  return [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `A ${r} ${r} 0 0 1 ${x + w} ${y + r}`,
    `V ${y + h}`,
    `H ${x}`,
    `V ${y + r}`,
    `A ${r} ${r} 0 0 1 ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

type BuildCardParams = {
  x: number;
  y: number;
  cardWidth: number;
  cardHeight: number;
  scale: number;
  t: Md3Tokens;
  chrome: MiCardChrome;
  employeeName: string;
  activeLoanCount: number;
  returnedLoanCount: number;
  bodyLines: readonly MiBodyLine[];
};

/**
 * 1 枚分のカード SVG（<g> 内用）。帯＋外枠＋ヘッダ文字＋本文 text。
 * 描画順: カード地 → 帯 → 氏名・件数 → 明細
 */
export function buildMiInspectionCardSvgFragment(params: BuildCardParams): string {
  const { x, y, cardWidth, cardHeight, scale, t, chrome, employeeName, activeLoanCount, returnedLoanCount, bodyLines } =
    params;
  const hasVisibleLoanState = chrome.hasLoans;
  const innerPad = Math.max(1, Math.round(MI_CARD_INNER_PAD_PX * scale));
  const maxRadius = Math.max(0, Math.floor(cardWidth / 2) - 1);
  const rx = Math.max(0, Math.min(Math.round(MI_CARD_CORNER_RADIUS_PX * scale), maxRadius));
  const ry = rx;
  const nameHeaderBaselineY = Math.round(MI_NAME_HEADER_BASELINE_YPX * scale);
  const namesStartY = Math.round(MI_NAMES_START_YPX * scale);
  const bandEndY = Math.round(MI_HEADER_BAND_END_YPX * scale);
  const countFontSize = Math.max(13, Math.round(14 * scale));
  const textLeft = x + innerPad;
  const textRight = x + cardWidth - innerPad;
  const headerBaselineOnCard = y + nameHeaderBaselineY;

  const bodySvg = (() => {
    let lineY = y + namesStartY;
    return bodyLines
      .map((line) => {
        const fill = line.isSpacer ? 'transparent' : resolveBodyFill(line.tone, hasVisibleLoanState, t);
        const advance = line.lineHeight;
        if (line.isSpacer) {
          lineY += advance;
          return '';
        }
        const textContent = escapeXml(line.text);
        const yPos = lineY;
        lineY += advance;
        return `<text x="${textLeft}" y="${yPos}"
              font-size="${line.fontSize}" font-weight="600" fill="${fill}" font-family="sans-serif">
              ${textContent}
            </text>`;
      })
      .filter(Boolean)
      .join('\n');
  })();

  const bandH = Math.min(bandEndY, cardHeight);
  const bandPath = buildTopRoundedBarPathD(x, y, cardWidth, bandH, rx, ry);

  return `<g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${rx}" ry="${ry}"
              fill="${chrome.cardFill}" stroke="${chrome.cardStroke}" />
            <path d="${bandPath}" fill="${chrome.bandFill}" />
            <text x="${textLeft}" y="${headerBaselineOnCard}"
              font-size="${Math.max(17, Math.round(19 * scale))}" font-weight="700" fill="${chrome.nameFill}" font-family="sans-serif">
              ${escapeXml(employeeName)}
            </text>
            <text x="${textRight}" y="${headerBaselineOnCard}"
              text-anchor="end" font-size="${countFontSize}" font-weight="700" fill="${chrome.countFill}" font-family="sans-serif">
              貸出中 ${activeLoanCount} ・ 返却 ${returnedLoanCount}
            </text>
            ${bodySvg}
          </g>`;
}
