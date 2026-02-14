import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import {
  createMd3Tokens,
  escapeSvgText,
} from '../_design-system/index.js';

type UninspectedMetadata = {
  date?: string;
  totalRunningMachines?: number;
  inspectedRunningCount?: number;
  uninspectedCount?: number;
  error?: string;
};

function escapeXml(value: string): string {
  return escapeSvgText(value);
}

function estimateTextWidth(text: string, fontPx: number): number {
  // Approximation tuned for mixed JP/ASCII text:
  // - ASCII-ish (<= 0xFF): 0.6em
  // - Wide chars (JP/CJK/emoji etc): 1.0em
  let usedEm = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    usedEm += code != null && code <= 0xff ? 0.6 : 1.0;
  }
  return Math.round(usedEm * fontPx);
}

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function parseInspectionResult(value: string): { normal: number; abnormal: number; isUnused: boolean } {
  if (value === '未使用') {
    return { normal: 0, abnormal: 0, isUnused: true };
  }
  const normalMatch = value.match(/正常\s*(\d+)/);
  const abnormalMatch = value.match(/異常\s*(\d+)/);
  const normal = normalMatch ? Number(normalMatch[1]) : 0;
  const abnormal = abnormalMatch ? Number(abnormalMatch[1]) : 0;
  return { normal, abnormal, isUnused: false };
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
        const isDateItem = item.label === '対象日';
        return `
          <g>
            <rect x="${x}" y="${y}" width="${kpiCardWidth}" height="${kpiHeight}"
              rx="${Math.round(10 * scale)}" ry="${Math.round(10 * scale)}"
              fill="${t.colors.card.fill}" stroke="${t.colors.card.border}" />
            ${!isDateItem ? `<text x="${x + Math.round(14 * scale)}" y="${y + Math.round(30 * scale)}"
              font-size="${Math.max(28, Math.round(32 * scale))}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">
              ${escapeXml(item.label)}
            </text>
            <text x="${x + kpiCardWidth - Math.round(14 * scale)}" y="${y + Math.round(74 * scale)}"
              text-anchor="end" font-size="${Math.max(32, Math.round(48 * scale))}" font-weight="700" fill="${item.accent}" font-family="sans-serif">
              ${escapeXml(item.value)}
            </text>` : `<text x="${x + kpiCardWidth / 2}" y="${y + kpiHeight / 2}"
              text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(32, Math.round(48 * scale))}" font-weight="700" fill="${item.accent}" font-family="sans-serif">
              ${escapeXml(item.value)}
            </text>`}
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
    
    // カード形式のレイアウト: 4列グリッド
    const cardsTop = tableTop;
    const cardsAreaWidth = width - padding * 2;
    const cardsAreaHeight = height - cardsTop - padding;
    const numColumns = 4;
    const cardGap = Math.round(12 * scale);
    const cardWidth = Math.floor((cardsAreaWidth - cardGap * (numColumns - 1)) / numColumns);
    const cardHeight = Math.round(140 * scale);
    const cardPadding = Math.round(14 * scale);
    
    // 1行に表示できるカード数と行数
    const cardsPerRow = numColumns;
    const availableRows = Math.max(1, Math.floor(cardsAreaHeight / (cardHeight + cardGap)));
    const maxDisplayCards = cardsPerRow * availableRows;
    const displayRows = allRows.slice(0, maxDisplayCards);

    const buildCardSvg = (row: Record<string, unknown>, index: number): string => {
      const col = index % numColumns;
      const rowIndex = Math.floor(index / numColumns);
      const cardX = padding + col * (cardWidth + cardGap);
      const cardY = cardsTop + rowIndex * (cardHeight + cardGap);
      
      const machineNumber = String(row[columns[0]] ?? '');
      const machineName = String(row[columns[1]] ?? '');
      const inspectionResult = String(row[columns[2]] ?? '');
      const { normal, abnormal, isUnused } = parseInspectionResult(inspectionResult);
      
      // 異常も正常も0以外のときのみカード背景色を発色
      const cardFill = (abnormal > 0 || normal > 0) && !isUnused ? t.colors.card.fill : t.colors.surface.background;
      const cardStroke = (abnormal > 0 || normal > 0) && !isUnused ? t.colors.card.border : 'transparent';
      
      // カード背景
      const cardBg = `
        <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}"
          rx="${Math.round(10 * scale)}" ry="${Math.round(10 * scale)}"
          fill="${cardFill}" stroke="${cardStroke}" />
      `;
      
      // カード内コンテンツを垂直方向に中央揃え
      const contentCenterY = cardY + cardHeight / 2;
      
      // 左側: 管理番号と加工機名（縦2段）
      const leftContentWidth = Math.floor(cardWidth * 0.6);
      const machineNumberFontSize = Math.max(20, Math.round(24 * scale));
      const machineNameFontSize = Math.max(16, Math.round(20 * scale));
      const leftContentGap = Math.round(8 * scale);
      const leftContentTotalHeight = machineNumberFontSize + leftContentGap + machineNameFontSize;
      const machineNumberY = contentCenterY - leftContentTotalHeight / 2 + machineNumberFontSize / 2;
      const machineNameY = machineNumberY + machineNumberFontSize / 2 + leftContentGap + machineNameFontSize / 2;
      
      const leftContent = `
        <text x="${cardX + cardPadding}" y="${machineNumberY}"
          dominant-baseline="middle" font-size="${machineNumberFontSize}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">
          ${escapeXml(machineNumber)}
        </text>
        <text x="${cardX + cardPadding}" y="${machineNameY}"
          dominant-baseline="middle" font-size="${machineNameFontSize}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">
          ${escapeXml(machineName)}
        </text>
      `;
      
      // 右側: 異常と正常（縦2段）
      const rightContentX = cardX + leftContentWidth;
      const rightContentWidth = cardWidth - leftContentWidth;
      const statusLabelFontSize = Math.max(14, Math.round(16 * scale));
      const statusValueFontSize = Math.max(18, Math.round(20 * scale));
      const statusGap = Math.round(6 * scale);
      const statusPadding = Math.round(3 * scale);
      const statusRadius = Math.round(6 * scale);
      
      let rightContent = '';
      if (isUnused) {
        rightContent = `
          <text x="${rightContentX + rightContentWidth / 2}" y="${contentCenterY}"
            text-anchor="middle" dominant-baseline="middle"
            font-size="${statusLabelFontSize}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">
            未使用
          </text>
        `;
      } else {
        // 正常と異常の合計高さ
        const statusItemHeight = statusValueFontSize + statusPadding * 2;
        const statusTotalHeight = statusItemHeight * 2 + statusGap;
        const statusStartY = contentCenterY - statusTotalHeight / 2;
        
        // 正常（上段）
        const normalItemCenterY = statusStartY + statusItemHeight / 2;
        const normalValueWidth = estimateTextWidth(String(normal), statusValueFontSize);
        const normalLabelX = rightContentX + rightContentWidth - normalValueWidth - Math.round(8 * scale) - estimateTextWidth('正常', statusLabelFontSize);
        rightContent += `
          <text x="${normalLabelX}" y="${normalItemCenterY}"
            dominant-baseline="middle" font-size="${statusLabelFontSize}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">
            正常
          </text>
          <rect x="${rightContentX + rightContentWidth - normalValueWidth - Math.round(8 * scale)}" y="${normalItemCenterY - statusItemHeight / 2}"
            width="${normalValueWidth + Math.round(16 * scale)}" height="${statusItemHeight}"
            rx="${statusRadius}" ry="${statusRadius}"
            fill="${t.colors.status.successContainer}" />
          <text x="${rightContentX + rightContentWidth - Math.round(8 * scale)}" y="${normalItemCenterY}"
            text-anchor="end" dominant-baseline="middle" font-size="${statusValueFontSize}" font-weight="700" fill="${t.colors.status.onSuccessContainer}" font-family="sans-serif">
            ${normal}
          </text>
        `;
        
        // 異常（下段）
        const abnormalItemCenterY = statusStartY + statusItemHeight + statusGap + statusItemHeight / 2;
        const abnormalValueWidth = estimateTextWidth(String(abnormal), statusValueFontSize);
        const abnormalLabelX = rightContentX + rightContentWidth - abnormalValueWidth - Math.round(8 * scale) - estimateTextWidth('異常', statusLabelFontSize);
        // 異常が0の場合は背景色を全体背景色と同じにする
        const abnormalBgFill = abnormal > 0 ? t.colors.status.errorContainer : t.colors.surface.background;
        const abnormalTextFill = abnormal > 0 ? t.colors.status.onErrorContainer : t.colors.text.secondary;
        rightContent += `
          <text x="${abnormalLabelX}" y="${abnormalItemCenterY}"
            dominant-baseline="middle" font-size="${statusLabelFontSize}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">
            異常
          </text>
          <rect x="${rightContentX + rightContentWidth - abnormalValueWidth - Math.round(8 * scale)}" y="${abnormalItemCenterY - statusItemHeight / 2}"
            width="${abnormalValueWidth + Math.round(16 * scale)}" height="${statusItemHeight}"
            rx="${statusRadius}" ry="${statusRadius}"
            fill="${abnormalBgFill}" />
          <text x="${rightContentX + rightContentWidth - Math.round(8 * scale)}" y="${abnormalItemCenterY}"
            text-anchor="end" dominant-baseline="middle" font-size="${statusValueFontSize}" font-weight="700" fill="${abnormalTextFill}" font-family="sans-serif">
            ${abnormal}
          </text>
        `;
      }
      
      return `${cardBg}${leftContent}${rightContent}`;
    };

    const cardsSvg = displayRows.map((row, index) => buildCardSvg(row, index)).join('\n');

    const truncatedMessage =
      allRows.length > displayRows.length
        ? `<text x="${width - padding}" y="${cardsTop - Math.round(6 * scale)}" text-anchor="end"
            font-size="${Math.max(11, Math.round(13 * scale))}" fill="${t.colors.text.secondary}" font-family="sans-serif">
            表示中 ${displayRows.length}/${allRows.length} 件
          </text>`
        : '';

    const emptyMessage =
      displayRows.length === 0
        ? `<text x="${padding}" y="${cardsTop + Math.round(34 * scale)}"
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
        ${cardsSvg}
        ${emptyMessage}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}

