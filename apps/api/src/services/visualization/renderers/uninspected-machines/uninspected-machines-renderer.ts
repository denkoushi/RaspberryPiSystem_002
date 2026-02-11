import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';

const BACKGROUND = '#020617';
const TEXT_COLOR = '#f8fafc';
const SUB_TEXT_COLOR = '#94a3b8';
const GRID_COLOR = '#334155';
const CARD_BG = 'rgba(255,255,255,0.06)';
const CARD_BORDER = 'rgba(255,255,255,0.12)';
const ALERT_COLOR = '#ef4444';
const OK_COLOR = '#10b981';

type UninspectedMetadata = {
  date?: string;
  totalRunningMachines?: number;
  inspectedRunningCount?: number;
  uninspectedCount?: number;
  error?: string;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
  const fontSize = Math.max(24, Math.round(width / 40));
  return `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${BACKGROUND}" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-size="${fontSize}" font-weight="600" fill="${TEXT_COLOR}" font-family="sans-serif">
        ${escapeXml(message)}
      </text>
    </svg>
  `;
}

export class UninspectedMachinesRenderer implements Renderer {
  readonly type = 'uninspected_machines';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    if (data.kind !== 'table') {
      const svg = buildMessageSvg('可視化データが不正です', config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const table = data as TableVisualizationData;
    const metadata = ((table.metadata ?? {}) as UninspectedMetadata) ?? {};
    if (metadata.error) {
      const svg = buildMessageSvg(`未点検加工機: ${metadata.error}`, config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const width = config.width;
    const height = config.height;
    const title = config.title ?? '未点検加工機';
    const scale = width / 1920;
    const padding = Math.round(24 * scale);
    const headerHeight = Math.round(68 * scale);
    const kpiTop = padding + headerHeight;
    const kpiHeight = Math.round(104 * scale);
    const kpiGap = Math.round(12 * scale);
    const tableTop = kpiTop + kpiHeight + Math.round(16 * scale);
    const maxRows = Number.isFinite(config.maxRows) ? Math.max(1, Math.floor(Number(config.maxRows))) : 18;

    const total = toNumber(metadata.totalRunningMachines, 0);
    const inspected = toNumber(metadata.inspectedRunningCount, 0);
    const uninspected = toNumber(metadata.uninspectedCount, table.rows.length);
    const targetDate = metadata.date ?? '-';

    const kpiItems = [
      { label: '対象日', value: targetDate, accent: SUB_TEXT_COLOR },
      { label: '稼働中', value: String(total), accent: TEXT_COLOR },
      { label: '点検済み', value: String(inspected), accent: OK_COLOR },
      { label: '未点検', value: String(uninspected), accent: uninspected > 0 ? ALERT_COLOR : OK_COLOR },
    ];

    const kpiCardWidth = Math.floor((width - padding * 2 - kpiGap * (kpiItems.length - 1)) / kpiItems.length);
    const kpiSvg = kpiItems
      .map((item, index) => {
        const x = padding + index * (kpiCardWidth + kpiGap);
        const y = kpiTop;
        return `
          <g>
            <rect x="${x}" y="${y}" width="${kpiCardWidth}" height="${kpiHeight}"
              rx="${Math.round(10 * scale)}" ry="${Math.round(10 * scale)}"
              fill="${CARD_BG}" stroke="${CARD_BORDER}" />
            <text x="${x + Math.round(14 * scale)}" y="${y + Math.round(30 * scale)}"
              font-size="${Math.max(14, Math.round(16 * scale))}" font-weight="600" fill="${SUB_TEXT_COLOR}" font-family="sans-serif">
              ${escapeXml(item.label)}
            </text>
            <text x="${x + Math.round(14 * scale)}" y="${y + Math.round(74 * scale)}"
              font-size="${Math.max(24, Math.round(34 * scale))}" font-weight="700" fill="${item.accent}" font-family="sans-serif">
              ${escapeXml(item.value)}
            </text>
          </g>
        `;
      })
      .join('\n');

    const columns = table.columns;
    if (columns.length === 0) {
      const svg = buildMessageSvg('表示列がありません', width, height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const rows = table.rows.slice(0, maxRows);
    const tableWidth = width - padding * 2;
    const headerRowHeight = Math.max(30, Math.round(36 * scale));
    const bodyRowHeight = Math.max(24, Math.round(30 * scale));
    const fallbackColWidth = Math.floor(tableWidth / columns.length);
    const colWidths = columns.map(() => fallbackColWidth);

    let xCursor = padding;
    const headerSvg = columns
      .map((column, index) => {
        const colWidth = colWidths[index] ?? fallbackColWidth;
        const local = `
          <rect x="${xCursor}" y="${tableTop}" width="${colWidth}" height="${headerRowHeight}" fill="${GRID_COLOR}" />
          <text x="${xCursor + Math.round(8 * scale)}" y="${tableTop + Math.round(headerRowHeight * 0.7)}"
            font-size="${Math.max(12, Math.round(14 * scale))}" font-weight="700" fill="${TEXT_COLOR}" font-family="sans-serif">
            ${escapeXml(column)}
          </text>
        `;
        xCursor += colWidth;
        return local;
      })
      .join('\n');

    const bodySvg = rows
      .map((row, rowIndex) => {
        const y = tableTop + headerRowHeight + rowIndex * bodyRowHeight;
        let cellX = padding;
        return columns
          .map((column, colIndex) => {
            const colWidth = colWidths[colIndex] ?? fallbackColWidth;
            const raw = row[column];
            const value = raw === null || raw === undefined ? '' : String(raw);
            const fill = rowIndex % 2 === 0 ? '#0f172a' : '#111827';
            const cell = `
              <rect x="${cellX}" y="${y}" width="${colWidth}" height="${bodyRowHeight}" fill="${fill}" />
              <text x="${cellX + Math.round(8 * scale)}" y="${y + Math.round(bodyRowHeight * 0.7)}"
                font-size="${Math.max(11, Math.round(13 * scale))}" fill="${TEXT_COLOR}" font-family="sans-serif">
                ${escapeXml(value)}
              </text>
            `;
            cellX += colWidth;
            return cell;
          })
          .join('\n');
      })
      .join('\n');

    const emptyMessage =
      rows.length === 0
        ? `<text x="${padding}" y="${tableTop + headerRowHeight + Math.round(34 * scale)}"
            font-size="${Math.max(14, Math.round(18 * scale))}" fill="${SUB_TEXT_COLOR}" font-family="sans-serif">
            未点検加工機はありません
          </text>`
        : '';

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${BACKGROUND}" />
        <text x="${padding}" y="${padding + Math.round(36 * scale)}"
          font-size="${Math.max(20, Math.round(30 * scale))}" font-weight="700" fill="${TEXT_COLOR}" font-family="sans-serif">
          ${escapeXml(title)}
        </text>
        ${kpiSvg}
        ${headerSvg}
        ${bodySvg}
        ${emptyMessage}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}

