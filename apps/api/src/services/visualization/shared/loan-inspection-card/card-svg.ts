import type { Md3Tokens } from '../../renderers/_design-system/md3.js';
import { escapeSvgText } from '../../renderers/_design-system/index.js';
import type { LoanInspectionBodyLine } from './display.types.js';
import {
  LOAN_INSPECTION_CARD_CORNER_RADIUS_PX,
  LOAN_INSPECTION_CARD_INNER_PAD_PX,
  LOAN_INSPECTION_HEADER_BAND_END_YPX,
  LOAN_INSPECTION_NAME_HEADER_BASELINE_YPX,
  LOAN_INSPECTION_NAMES_START_YPX,
} from './card-metrics.js';
import type { LoanInspectionCardChrome } from './card-palette.js';
import { resolveBodyFill } from './body-fill.js';

function escapeXml(value: string): string {
  return escapeSvgText(value);
}

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
  chrome: LoanInspectionCardChrome;
  employeeName: string;
  activeLoanCount: number;
  returnedLoanCount: number;
  bodyLines: readonly LoanInspectionBodyLine[];
};

export function buildLoanInspectionCardSvgFragment(params: BuildCardParams): string {
  const { x, y, cardWidth, cardHeight, scale, t, chrome, employeeName, activeLoanCount, returnedLoanCount, bodyLines } =
    params;
  const hasVisibleLoanState = chrome.hasLoans;
  const innerPad = Math.max(1, Math.round(LOAN_INSPECTION_CARD_INNER_PAD_PX * scale));
  const maxRadius = Math.max(0, Math.floor(cardWidth / 2) - 1);
  const rx = Math.max(0, Math.min(Math.round(LOAN_INSPECTION_CARD_CORNER_RADIUS_PX * scale), maxRadius));
  const ry = rx;
  const nameHeaderBaselineY = Math.round(LOAN_INSPECTION_NAME_HEADER_BASELINE_YPX * scale);
  const namesStartY = Math.round(LOAN_INSPECTION_NAMES_START_YPX * scale);
  const bandEndY = Math.round(LOAN_INSPECTION_HEADER_BAND_END_YPX * scale);
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
