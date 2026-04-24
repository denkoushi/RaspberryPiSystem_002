import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { createMd3Tokens, escapeSvgText } from '../_design-system/index.js';
import { planMiInspectionCardPlacements } from './card-layout.js';
import { MI_RETURNED_COUNT_COLUMN } from './mi-instrument-display.types.js';
import type { MiLoanInspectionTableRow } from './row-priority.js';
import { sortRowsForDisplay } from './row-priority.js';
import { resolveMiCardChrome } from './mi-instrument-card-palette.js';
import { buildMiInspectionCardSvgFragment } from './mi-inspection-card-svg.js';

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
    const cardsSvg = placements
      .map((p) => {
        const { x, y, height: cardHeight, bodyLines } = p;
        const row = p.row;
        const employeeName = String(row['従業員名'] ?? '-');
        const activeLoanCount = toNumber(row['貸出中計測機器数'], 0);
        const returnedLoanCount = toNumber(row[MI_RETURNED_COUNT_COLUMN], 0);
        const hasVisibleLoanState = activeLoanCount > 0 || returnedLoanCount > 0;
        const chrome = resolveMiCardChrome(t, hasVisibleLoanState);
        return buildMiInspectionCardSvgFragment({
          x,
          y,
          cardWidth,
          cardHeight,
          scale,
          t,
          chrome,
          employeeName,
          activeLoanCount,
          returnedLoanCount,
          bodyLines,
        });
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
