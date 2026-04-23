import sharp from 'sharp';
import type { Md3Tokens } from '../_design-system/md3.js';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { createMd3Tokens, escapeSvgText } from '../_design-system/index.js';
import { planMiInspectionCardPlacements } from './card-layout.js';
import { MI_RETURNED_COUNT_COLUMN, type BodyLineTone } from './mi-instrument-display.types.js';
import type { MiLoanInspectionTableRow } from './row-priority.js';
import { sortRowsForDisplay } from './row-priority.js';

type LoanInspectionMetadata = {
  sectionEquals?: string;
  targetDate?: string;
  totalUsers?: number;
  inspectedUsers?: number;
  error?: string;
};

function escapeXml(value: string): string {
  return escapeSvgText(value);
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function buildMessageSvg(message: string, width: number, height: number): string {
  const t = createMd3Tokens({ width, height });
  const fontSize = Math.max(24, Math.round(width / 40));
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-size="${fontSize}" font-weight="600" fill="${t.colors.text.primary}" font-family="sans-serif">
        ${escapeXml(message)}
      </text>
    </svg>
  `;
}

function resolveBodyFill(tone: BodyLineTone, inspected: boolean, t: Md3Tokens): string {
  if (!inspected) {
    if (tone === 'muted') {
      return t.colors.outline;
    }
    if (tone === 'primary') {
      return t.colors.text.primary;
    }
    return t.colors.text.secondary;
  }
  if (tone === 'muted') {
    return t.colors.outline;
  }
  return t.colors.status.onInfoContainer;
}

const NAMES_START_YPX = 66;
const NAME_HEADER_BASELINE_YPX = 34;

export class MeasuringInstrumentLoanInspectionRenderer implements Renderer {
  readonly type = 'measuring_instrument_loan_inspection';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    if (data.kind !== 'table') {
      const svg = buildMessageSvg('可視化データが不正です', config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const table = data as TableVisualizationData;
    const metadata = ((table.metadata ?? {}) as LoanInspectionMetadata) ?? {};
    if (metadata.error) {
      const svg = buildMessageSvg(`計測機器持出状況: ${metadata.error}`, config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const width = config.width;
    const height = config.height;
    const title = (config.title ?? '計測機器持出状況').replace('（点検可視化）', '').trim();
    const t = createMd3Tokens({ width, height });
    const scale = t.scale;
    const padding = Math.round(12 * scale);
    const targetDate = typeof metadata.targetDate === 'string' ? metadata.targetDate : '-';
    const titleFontSize = Math.max(20, Math.round(30 * scale));
    const dateFontSize = Math.max(16, Math.round(24 * scale));
    const headerBaselineY = padding + Math.round(36 * scale);
    const cardsTop = padding + Math.round(52 * scale) + Math.round(10 * scale);
    const cardsAreaHeight = height - cardsTop - padding;
    const cardGap = Math.round(12 * scale);
    const numColumns = 4;
    const cardsAreaWidth = width - padding * 2;
    const cardWidth = Math.floor((cardsAreaWidth - cardGap * (numColumns - 1)) / numColumns);
    const sortedRows = sortRowsForDisplay(
      (table.rows ?? []) as readonly MiLoanInspectionTableRow[],
    );
    const { placements, truncated, totalRows, placedCount } = planMiInspectionCardPlacements({
      rows: sortedRows,
      cardsTop,
      cardsAreaHeight,
      padding,
      cardWidth,
      cardGap,
      numColumns,
      scale,
    });
    const namesStartY = Math.round(NAMES_START_YPX * scale);
    const nameHeaderBaselineY = Math.round(NAME_HEADER_BASELINE_YPX * scale);
    const countFontSize = Math.max(13, Math.round(14 * scale));
    const innerPad = Math.round(12 * scale);
    const cardsSvg = placements
      .map((p) => {
        const { x, y, height: cardHeight, bodyLines } = p;
        const row = p.row;
        const employeeName = String(row['従業員名'] ?? '-');
        const activeLoanCount = toNumber(row['貸出中計測機器数'], 0);
        const returnedLoanCount = toNumber(row[MI_RETURNED_COUNT_COLUMN], 0);
        const hasVisibleLoanState = activeLoanCount > 0 || returnedLoanCount > 0;
        const cardFill = hasVisibleLoanState ? t.colors.status.infoContainer : '#020617';
        const cardStroke = hasVisibleLoanState ? 'transparent' : t.colors.card.border;
        const primaryText = hasVisibleLoanState ? t.colors.status.onInfoContainer : t.colors.text.primary;
        const secondaryText = hasVisibleLoanState ? t.colors.status.onInfoContainer : t.colors.text.secondary;
        const textLeft = x + innerPad;
        const textRight = x + cardWidth - innerPad;
        const headerBaselineOnCard = y + nameHeaderBaselineY;
        let lineY = y + namesStartY;
        const bodySvg = bodyLines
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
        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${Math.round(10 * scale)}" ry="${Math.round(10 * scale)}"
              fill="${cardFill}" stroke="${cardStroke}" />
            <text x="${textLeft}" y="${headerBaselineOnCard}"
              font-size="${Math.max(17, Math.round(19 * scale))}" font-weight="700" fill="${primaryText}" font-family="sans-serif">
              ${escapeXml(employeeName)}
            </text>
            <text x="${textRight}" y="${headerBaselineOnCard}"
              text-anchor="end" font-size="${countFontSize}" font-weight="700" fill="${secondaryText}" font-family="sans-serif">
              貸出中 ${activeLoanCount} ・ 返却 ${returnedLoanCount}
            </text>
            ${bodySvg}
          </g>
        `;
      })
      .join('\n');
    const emptyMessage =
      sortedRows.length === 0
        ? `<text x="${padding}" y="${cardsTop + Math.round(34 * scale)}"
            font-size="${Math.max(14, Math.round(18 * scale))}" fill="${t.colors.text.secondary}" font-family="sans-serif">
            対象従業員がありません
          </text>`
        : '';
    const warnTruncated =
      truncated
        ? `<text x="${width - padding}" y="${height - padding}"
            text-anchor="end" font-size="${Math.max(12, Math.round(16 * scale))}" font-weight="600" fill="#fcd34d" font-family="sans-serif">
            以降 ${totalRows - placedCount} 名は1画面に収まりません
          </text>`
        : '';
    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
        <text x="${padding}" y="${headerBaselineY}" font-size="${titleFontSize}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">
          ${escapeXml(title)}
        </text>
        <text x="${width - padding}" y="${headerBaselineY}" text-anchor="end" font-size="${dateFontSize}" font-weight="700" fill="${t.colors.text.secondary}" font-family="sans-serif">
          ${escapeXml(targetDate)}
        </text>
        ${cardsSvg}
        ${emptyMessage}
        ${warnTruncated}
      </svg>
    `;
    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
