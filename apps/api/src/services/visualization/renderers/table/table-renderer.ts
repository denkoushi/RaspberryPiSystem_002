import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { createMd3Tokens } from '../_design-system/index.js';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

export class TableRenderer implements Renderer {
  readonly type = 'table';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    if (data.kind !== 'table') {
      const svg = buildMessageSvg('可視化データが不正です', config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const table = data as TableVisualizationData;
    const width = config.width;
    const height = config.height;
    const title = config.title ?? '可視化';
    const t = createMd3Tokens({ width, height });
    const scale = t.scale;
    const padding = Math.round(24 * scale);
    const headerHeight = Math.round(72 * scale);
    const rowHeight = Math.max(28, Math.round(34 * scale));
    const columnHeaderHeight = Math.max(28, Math.round(36 * scale));

    const columns = table.columns ?? [];
    const maxRows = Number.isFinite(config.maxRows) ? Math.max(1, Number(config.maxRows)) : 20;
    const rows = (table.rows ?? []).slice(0, maxRows);

    if (columns.length === 0) {
      const svg = buildMessageSvg('表示列がありません', width, height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const tableWidth = width - padding * 2;
    const tableHeight = height - padding * 2 - headerHeight;
    const columnWidths: number[] = [];
    const configuredWidths =
      config.columnWidths && typeof config.columnWidths === 'object' && !Array.isArray(config.columnWidths)
        ? (config.columnWidths as Record<string, number>)
        : {};

    const fallbackWidth = Math.floor(tableWidth / columns.length);
    for (const column of columns) {
      const configured = configuredWidths[column];
      columnWidths.push(Number.isFinite(configured) && configured > 0 ? Math.round(configured) : fallbackWidth);
    }

    const totalWidth = columnWidths.reduce((sum, value) => sum + value, 0);
    const normalizedWidths =
      totalWidth === 0 ? columnWidths : columnWidths.map((w) => Math.max(40, Math.round((w / totalWidth) * tableWidth)));

    let xCursor = padding;
    const headerLabelsSvg = columns
      .map((column, index) => {
        const cellWidth = normalizedWidths[index] ?? fallbackWidth;
        const textX = xCursor + 8;
        const textY = padding + headerHeight + Math.round(columnHeaderHeight * 0.7);
        const rect = `<rect x="${xCursor}" y="${padding + headerHeight}" width="${cellWidth}" height="${columnHeaderHeight}" fill="${t.colors.table.headerFill}" />`;
        const text = `<text x="${textX}" y="${textY}" font-size="${t.typography.header.size}" font-weight="${t.typography.header.weight}" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeXml(column)}</text>`;
        const block = `${rect}${text}`;
        xCursor += cellWidth;
        return block;
      })
      .join('\n');

    const rowsSvg = rows
      .map((row, rowIndex) => {
        let cellX = padding;
        const cellY = padding + headerHeight + columnHeaderHeight + rowIndex * rowHeight;
        const cells = columns
          .map((column, colIndex) => {
            const cellWidth = normalizedWidths[colIndex] ?? fallbackWidth;
            const value = row[column];
            const textValue = value === null || value === undefined ? '' : String(value);
            const textX = cellX + 8;
            const textY = cellY + Math.round(rowHeight * 0.7);
            const rect = `<rect x="${cellX}" y="${cellY}" width="${cellWidth}" height="${rowHeight}" fill="${rowIndex % 2 === 0 ? t.colors.table.rowFillEven : t.colors.table.rowFillOdd}" />`;
            const text = `<text x="${textX}" y="${textY}" font-size="${t.typography.body.size}" font-weight="${t.typography.body.weight}" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeXml(textValue)}</text>`;
            cellX += cellWidth;
            return `${rect}${text}`;
          })
          .join('\n');
        return cells;
      })
      .join('\n');

    const gridLines = normalizedWidths
      .reduce(
        (lines, widthValue, index) => {
          if (index === 0) return lines;
          const x = padding + normalizedWidths.slice(0, index).reduce((sum, v) => sum + v, 0);
          lines.push(
            `<line x1="${x}" y1="${padding + headerHeight}" x2="${x}" y2="${padding + headerHeight + tableHeight}" stroke="${t.colors.grid}" stroke-width="1" />`
          );
          return lines;
        },
        [] as string[]
      )
      .join('\n');

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
        <text x="${padding}" y="${padding + Math.round(36 * scale)}"
          font-size="${t.typography.title.size}" font-weight="${t.typography.title.weight}" fill="${t.colors.text.primary}" font-family="sans-serif">
          ${escapeXml(title)}
        </text>
        ${headerLabelsSvg}
        ${rowsSvg}
        ${gridLines}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
