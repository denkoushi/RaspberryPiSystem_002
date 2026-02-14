import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { createMd3Tokens } from '../_design-system/index.js';

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

function resolveInspectionResultCellStyle(
  column: string,
  value: string,
  rowIndex: number,
  t: ReturnType<typeof createMd3Tokens>
): { fill: string; textColor: string } {
  const baseFill = rowIndex % 2 === 0 ? t.colors.table.rowFillEven : t.colors.table.rowFillOdd;
  if (column !== '点検結果') {
    return { fill: baseFill, textColor: t.colors.text.primary };
  }
  if (value === '未使用') {
    return { fill: baseFill, textColor: t.colors.text.primary };
  }
  const abnormalMatch = value.match(/異常\s*(\d+)/);
  const abnormalCount = abnormalMatch ? Number(abnormalMatch[1]) : 0;
  if (abnormalCount >= 1) {
    return { fill: t.colors.status.errorContainer, textColor: t.colors.status.onErrorContainer };
  }
  // 異常0件は青系（情報）で強調
  return { fill: t.colors.status.infoContainer, textColor: t.colors.status.onInfoContainer };
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
      const svg = buildMessageSvg(`加工機点検状況: ${metadata.error}`, config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const width = config.width;
    const height = config.height;
    const title = config.title ?? '加工機点検状況';
    const t = createMd3Tokens({ width, height });
    const scale = t.scale;
    const padding = Math.round(12 * scale);
    const headerHeight = Math.round(56 * scale);
    const kpiTop = padding + headerHeight;
    const kpiHeight = Math.round(92 * scale);
    const kpiGap = Math.round(10 * scale);
    const tableTop = kpiTop + kpiHeight + Math.round(10 * scale);
    const maxRows = Number.isFinite(config.maxRows)
      ? Math.max(1, Math.floor(Number(config.maxRows)))
      : Number.MAX_SAFE_INTEGER;

    const total = toNumber(metadata.totalRunningMachines, 0);
    const inspected = toNumber(metadata.inspectedRunningCount, 0);
    const uninspected = toNumber(metadata.uninspectedCount, table.rows.length);
    const targetDate = metadata.date ?? '-';

    const kpiItems = [
      { label: '対象日', value: targetDate, accent: t.colors.text.secondary },
      { label: '稼働中', value: String(total), accent: t.colors.text.primary },
      { label: '点検済み', value: String(inspected), accent: t.colors.status.success },
      { label: '未点検', value: String(uninspected), accent: uninspected > 0 ? t.colors.status.error : t.colors.status.success },
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
              fill="${t.colors.card.fill}" stroke="${t.colors.card.border}" />
            <text x="${x + Math.round(14 * scale)}" y="${y + Math.round(30 * scale)}"
              font-size="${Math.max(14, Math.round(16 * scale))}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">
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

    const allRows = table.rows.slice(0, maxRows);
    const tableWidth = width - padding * 2;
    const paneGap = Math.round(10 * scale);
    const paneWidth = Math.floor((tableWidth - paneGap) / 2);
    const headerRowHeight = Math.max(26, Math.round(30 * scale));
    const minBodyRowHeight = Math.max(18, Math.round(18 * scale));
    const availableBodyHeight = height - tableTop - padding;
    const rowsPerColumnCapacity = Math.max(1, Math.floor((availableBodyHeight - headerRowHeight) / minBodyRowHeight));
    const displayCapacity = rowsPerColumnCapacity * 2;
    const rows = allRows.slice(0, displayCapacity);
    const leftRowsCount = Math.ceil(rows.length / 2);
    const leftRows = rows.slice(0, leftRowsCount);
    const rightRows = rows.slice(leftRowsCount);
    const maxRowsInColumn = Math.max(leftRows.length, rightRows.length, 1);
    const bodyRowHeight = Math.max(
      minBodyRowHeight,
      Math.floor((availableBodyHeight - headerRowHeight) / maxRowsInColumn)
    );

    const paneColumns = columns.slice(0, 3);
    const equalColWidth = Math.floor(paneWidth / paneColumns.length);
    const colWidths =
      paneColumns.length === 3
        ? [
            Math.floor(paneWidth * 0.26),
            Math.floor(paneWidth * 0.42),
            paneWidth - Math.floor(paneWidth * 0.26) - Math.floor(paneWidth * 0.42),
          ]
        : paneColumns.map(() => equalColWidth);

    const buildPaneSvg = (startX: number, paneRows: Array<Record<string, unknown>>) => {
      let headerX = startX;
      const paneHeader = paneColumns
        .map((column, index) => {
          const colWidth = colWidths[index] ?? equalColWidth;
          const cell = `
            <rect x="${headerX}" y="${tableTop}" width="${colWidth}" height="${headerRowHeight}" fill="${t.colors.table.headerFill}" />
            <text x="${headerX + Math.round(6 * scale)}" y="${tableTop + Math.round(headerRowHeight * 0.7)}"
              font-size="${Math.max(13, Math.round(15 * scale))}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">
              ${escapeXml(column)}
            </text>
          `;
          headerX += colWidth;
          return cell;
        })
        .join('\n');

      const paneBody = paneRows
        .map((row, rowIndex) => {
          const y = tableTop + headerRowHeight + rowIndex * bodyRowHeight;
          let cellX = startX;
          return paneColumns
            .map((column, colIndex) => {
              const colWidth = colWidths[colIndex] ?? equalColWidth;
              const raw = row[column];
              const value = raw === null || raw === undefined ? '' : String(raw);
              const style = resolveInspectionResultCellStyle(column, value, rowIndex, t);
              const cell = `
                <rect x="${cellX}" y="${y}" width="${colWidth}" height="${bodyRowHeight}" fill="${style.fill}" />
                <text x="${cellX + Math.round(6 * scale)}" y="${y + Math.round(bodyRowHeight * 0.7)}"
                  font-size="${Math.max(12, Math.round(14 * scale))}" font-weight="600" fill="${style.textColor}" font-family="sans-serif">
                  ${escapeXml(value)}
                </text>
              `;
              cellX += colWidth;
              return cell;
            })
            .join('\n');
        })
        .join('\n');

      return `${paneHeader}\n${paneBody}`;
    };

    const leftPaneSvg = buildPaneSvg(padding, leftRows);
    const rightPaneSvg = buildPaneSvg(padding + paneWidth + paneGap, rightRows);

    const truncatedMessage =
      allRows.length > rows.length
        ? `<text x="${width - padding}" y="${tableTop - Math.round(6 * scale)}" text-anchor="end"
            font-size="${Math.max(11, Math.round(13 * scale))}" fill="${t.colors.text.secondary}" font-family="sans-serif">
            表示中 ${rows.length}/${allRows.length} 件
          </text>`
        : '';

    const emptyMessage =
      rows.length === 0
        ? `<text x="${padding}" y="${tableTop + headerRowHeight + Math.round(34 * scale)}"
            font-size="${Math.max(14, Math.round(18 * scale))}" fill="${t.colors.text.secondary}" font-family="sans-serif">
            対象加工機はありません
          </text>`
        : '';

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
        <text x="${padding}" y="${padding + Math.round(36 * scale)}"
          font-size="${Math.max(20, Math.round(30 * scale))}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">
          ${escapeXml(title)}
        </text>
        ${kpiSvg}
        ${truncatedMessage}
        ${leftPaneSvg}
        ${rightPaneSvg}
        ${emptyMessage}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}

