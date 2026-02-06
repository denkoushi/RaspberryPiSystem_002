import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { layoutTextInBounds } from '../_text/text-layout.js';

const BACKGROUND = '#020617';
const TEXT_COLOR = '#f8fafc';
const SUB_TEXT_COLOR = '#94a3b8';
const BORDER_COLOR = '#334155';
const CARD_BG = 'rgba(255,255,255,0.06)';
const COMPLETE_COLOR = '#10b981'; // 100%
const PROGRESS_BLUE = '#3b82f6'; // 71-99%
const PROGRESS_YELLOW = '#f59e0b'; // 31-70%
const INCOMPLETE_COLOR = '#ef4444'; // 0-30%
const NEUTRAL_COLOR = '#38bdf8';
const BAR_BG = '#1e293b';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function accentForPercent(percentRaw: number): string {
  const percent = clampNumber(Math.round(percentRaw), 0, 100);
  if (percent >= 100) return COMPLETE_COLOR;
  if (percent >= 71) return PROGRESS_BLUE;
  if (percent >= 31) return PROGRESS_YELLOW;
  return INCOMPLETE_COLOR;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function estimateTextWidth(text: string, fontPx: number): number {
  return Math.round(text.length * fontPx * 0.6);
}

function estimateMaxCharsPerLine(availableWidthPx: number, fontPx: number): number {
  // SVGのsans-serifを前提とした雑な近似。見積りがズレても、最終的に…で破綻を防ぐ。
  const approxCharWidth = Math.max(6, fontPx * 0.55);
  return Math.max(6, Math.floor(availableWidthPx / approxCharWidth));
}


function buildKpiInlineSvg(options: {
  xStart: number;
  xEnd: number;
  yBaseline: number;
  scale: number;
  stats: Array<{ label: string; value: string; color: string }>;
}): string {
  const labelShortMap: Record<string, string> = {
    総製番数: '製番',
    総部品数: '部品',
    完了部品数: '完了',
    進捗率: '率',
  };
  const availableWidth = Math.max(0, options.xEnd - options.xStart);
  if (availableWidth <= 0) return '';

  const summaryText = options.stats
    .map((stat) => {
      const label = labelShortMap[stat.label] ?? stat.label;
      return `${label} ${stat.value}`;
    })
    .join(' / ');

  const fontMax = Math.max(14, Math.round(20 * options.scale));
  const fontMin = Math.max(12, Math.round(14 * options.scale));
  const chipPaddingX = Math.round(12 * options.scale);
  const chipPaddingY = Math.round(6 * options.scale);

  let fontSize = fontMax;
  let displayText = summaryText;
  for (; fontSize >= fontMin; fontSize -= 1) {
    const width = estimateTextWidth(displayText, fontSize) + chipPaddingX * 2;
    if (width <= availableWidth) {
      break;
    }
  }

  if (estimateTextWidth(displayText, fontSize) + chipPaddingX * 2 > availableWidth) {
    const maxChars = estimateMaxCharsPerLine(availableWidth - chipPaddingX * 2, fontSize);
    displayText = truncateText(displayText, maxChars);
  }

  const textWidth = estimateTextWidth(displayText, fontSize);
  const chipWidth = Math.max(Math.round(140 * options.scale), Math.min(availableWidth, textWidth + chipPaddingX * 2));
  const chipHeight = Math.round(fontSize * 1.2) + chipPaddingY * 2;
  const chipX = Math.round(options.xStart);
  const chipY = Math.round(options.yBaseline - Math.round(fontSize * 0.9) - chipPaddingY);
  const textX = chipX + chipPaddingX;
  const textY = chipY + chipPaddingY + Math.round(fontSize * 0.95);

  return `
    <g>
      <rect x="${chipX}" y="${chipY}" width="${chipWidth}" height="${chipHeight}"
        rx="${Math.round(10 * options.scale)}" ry="${Math.round(10 * options.scale)}"
        fill="rgba(255,255,255,0.05)" stroke="${BORDER_COLOR}" stroke-width="${Math.max(1, Math.round(2 * options.scale))}" />
      <text x="${textX}" y="${textY}"
        font-size="${fontSize}" font-weight="700" fill="${TEXT_COLOR}" font-family="sans-serif">
        ${escapeXml(displayText)}
      </text>
    </g>
  `;
}

export class ProgressListRenderer implements Renderer {
  readonly type = 'progress_list';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    if (data.kind !== 'table') {
      const svg = buildMessageSvg('可視化データが不正です', config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const table = data as TableVisualizationData;
    const width = config.width;
    const height = config.height;
    // タイトルを「生産進捗」に変更
    const title = config.title ?? '生産進捗';
    const rows = table.rows ?? [];

    if (rows.length === 0) {
      const svg = buildMessageSvg('登録製番がありません', width, height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const scale = width / 1920;
    const padding = Math.round(24 * scale);
    // タイトルのみのヘッダー高さに調整（サブタイトル削除）
    const headerHeight = Math.round(80 * scale);
    const gap = Math.round(24 * scale);

    const totalSeibanCount = rows.length;
    const totalParts = rows.reduce((sum, row) => sum + (toNumber(row.total) ?? 0), 0);
    const completedParts = rows.reduce((sum, row) => sum + (toNumber(row.completed) ?? 0), 0);
    const progressRate = totalParts > 0 ? Math.round((completedParts / totalParts) * 100) : 0;

    const columnsRaw = toNumber(config.columns);
    const fixedColumns = columnsRaw != null ? clampNumber(columnsRaw, 1, 4) : null;

    const gridTop = padding + headerHeight + gap;
    const gridHeight = (height - gridTop - padding) * 0.7;
    const cardGap = Math.round(24 * scale);

    // 可読性下限（ユーザー指定）を守りつつ、可能な限り表示数を増やす
    const minPrimaryFont = 18;
    const minPartsFont = 14;
    const minCardWidth = Math.round(360 * scale);
    const minCardHeight = Math.round(105 * scale); // 20件表示対応のため高さを半分に

    const maxColumns = 4;

    function chooseAutoColumns(totalItems: number): {
      columns: number;
      rowsVisible: number;
      cardWidth: number;
      cardHeight: number;
      capacity: number;
    } {
      // 収容可能行数（高さ）を見積る。カード高さが下限を下回る場合は溢れ扱いにする。
      let best = {
        columns: 1,
        rowsVisible: 1,
        cardWidth: Math.max(1, width - padding * 2),
        cardHeight: Math.max(1, gridHeight),
        capacity: 1,
      };

      for (let cols = 1; cols <= maxColumns; cols += 1) {
        const cw = Math.floor((width - padding * 2 - cardGap * (cols - 1)) / cols);
        if (cw < minCardWidth) continue;

        const rowsFit = Math.floor((gridHeight + cardGap) / (minCardHeight + cardGap));
        if (rowsFit < 1) continue;

        const capacity = cols * rowsFit;
        // より多く表示できる構成を優先（同数なら列数が大きい方）
        if (capacity > best.capacity || (capacity === best.capacity && cols > best.columns)) {
          const rowsVisible = Math.max(1, Math.min(rowsFit, Math.ceil(Math.min(totalItems, capacity) / cols)));
          const ch = Math.floor((gridHeight - cardGap * (rowsVisible - 1)) / rowsVisible);
          best = { columns: cols, rowsVisible, cardWidth: cw, cardHeight: ch, capacity };
        }
      }

      return best;
    }

    const layout =
      fixedColumns != null
        ? (() => {
            const columns = fixedColumns;
            const cardWidth = Math.floor((width - padding * 2 - cardGap * (columns - 1)) / columns);
            const rowsVisible = Math.max(1, Math.ceil(rows.length / columns));
            const cardHeight = Math.floor((gridHeight - cardGap * (rowsVisible - 1)) / rowsVisible);
            const capacity = columns * rowsVisible;
            return { columns, rowsVisible, cardWidth, cardHeight, capacity };
          })()
        : chooseAutoColumns(rows.length);

    const columns = layout.columns;
    const cardWidth = layout.cardWidth;
    const cardHeight = layout.cardHeight;

    const visibleCapacity = fixedColumns != null ? rows.length : Math.min(rows.length, layout.capacity);
    const overflowCount = Math.max(0, rows.length - visibleCapacity);
    const visibleRows = rows.slice(0, visibleCapacity);

    const stats = [
      { label: '総製番数', value: String(totalSeibanCount), color: NEUTRAL_COLOR },
      { label: '総部品数', value: String(totalParts), color: NEUTRAL_COLOR },
      { label: '完了部品数', value: String(completedParts), color: COMPLETE_COLOR },
      { label: '進捗率', value: `${progressRate}%`, color: NEUTRAL_COLOR },
    ];

    // HTMLのスタイルに合わせてタイトルフォントサイズを48pxに変更（以前は34px）
    const titleFont = Math.max(20, Math.round(48 * scale));
    const titleY = padding + Math.round(titleFont * 0.8);
    // KPIチップを右端に配置（タイトルとの重なりを防ぐ）
    const kpiInlineSvg = buildKpiInlineSvg({
      xStart: width - padding - Math.round(400 * scale), // 右端から400px以内（必要に応じて調整）
      xEnd: width - padding,
      yBaseline: titleY,
      scale,
      stats,
    });

    const overflowBadgeSvg =
      overflowCount > 0
        ? `
          <text x="${width - padding}" y="${height - Math.round(12 * scale)}"
            text-anchor="end" font-size="${Math.max(16, Math.round(18 * scale))}" font-weight="700"
            fill="#fcd34d" font-family="sans-serif">
            さらに ${overflowCount} 件
          </text>
        `
        : '';

    const cardsSvg = visibleRows
      .map((row, index) => {
        const column = index % columns;
        const rowIndex = Math.floor(index / columns);
        const x = padding + column * (cardWidth + cardGap);
        const y = gridTop + rowIndex * (cardHeight + cardGap);

        const rowRecord = row as Record<string, unknown>;
        const fseiban = String(rowRecord.FSEIBAN ?? '');
        const incompleteParts = String(rowRecord.INCOMPLETE_PARTS ?? rowRecord.incompleteParts ?? '');
        const completed = toNumber(row.completed) ?? 0;
        const total = toNumber(row.total) ?? 0;
        const percent = toNumber(row.percent) ?? (total > 0 ? Math.round((completed / total) * 100) : 0);
        const status = String(row.status ?? '未完了');

        const isCompleted = status === '完了';
        const accent = accentForPercent(percent);

        // カードが小さくなる場合でも下限を守る（カード高さを半分にしたので基準値も半分に）
        const cardScale = Math.min(1, cardWidth / Math.round(540 * scale), cardHeight / Math.round(130 * scale));
        const effectiveScale = scale * cardScale;

        const seibanFont = Math.max(minPrimaryFont, Math.round(32 * effectiveScale));
        const partsFontPreferred = Math.max(minPartsFont, Math.round(18 * effectiveScale));
        const percentFont = Math.max(minPrimaryFont, Math.round(22 * effectiveScale));
        // HTMLのスタイルに合わせて進捗バーの高さを32px相当に変更（以前の約半分から戻す）
        const barHeight = Math.max(16, Math.round(32 * effectiveScale));
        // 左右パディングを統一（各16px）
        const cardPaddingX = Math.round(16 * scale);
        const barWidth = Math.floor(cardWidth - cardPaddingX * 2);
        const barX = x + cardPaddingX;
        const fillWidth = Math.round((barWidth * clampNumber(percent, 0, 100)) / 100);
        const partsAvailableWidth = Math.max(1, cardWidth - cardPaddingX * 2);
        const labelFont = Math.max(12, Math.round(14 * effectiveScale));
        const labelLineHeight = Math.round(labelFont * 1.2);
        const partsLineHeight = Math.round(partsFontPreferred * 1.25);
        const partsX = x + cardPaddingX;

        const cardTopPadding = Math.round(12 * scale);
        const blockGap = Math.round(6 * scale);
        const labelGap = Math.round(4 * scale);
        const seibanY = y + cardTopPadding + seibanFont;
        const labelY = seibanY + blockGap + labelLineHeight;
        const partsStartY = labelY + labelGap + partsLineHeight;

        const barBottomPadding = Math.round(12 * scale);
        const percentTextGap = Math.round(6 * scale);
        const percentTextY = y + cardHeight - barBottomPadding - barHeight - percentTextGap;
        const barY = y + cardHeight - barBottomPadding - barHeight;
        const availableTextHeight = Math.max(0, percentTextY - partsStartY);
        const maxLinesParts = clampNumber(Math.floor(availableTextHeight / partsLineHeight), 0, 3);
        const partsLabel = isCompleted ? '未完部品: なし' : '未完部品:';
        const labelMaxChars = estimateMaxCharsPerLine(partsAvailableWidth, labelFont);
        const labelText = truncateText(partsLabel, labelMaxChars);
        const partsBody = isCompleted ? '' : (incompleteParts || '(不明)');
        const partsSafetyChars = 1;
        const partsLayout =
          !isCompleted && maxLinesParts > 0
            ? layoutTextInBounds(partsBody, {
                availableWidthPx: partsAvailableWidth,
                fontPx: partsFontPreferred,
                maxLines: maxLinesParts,
                safetyChars: partsSafetyChars,
              })
            : { lines: [], truncated: false, maxCharsPerLine: 0 };
        const resolvedPartsLineHeight = Math.round(partsFontPreferred * 1.25);
        const partsLinesSvg = partsLayout.lines
          .map((line, i) => {
            const yy = partsStartY + i * resolvedPartsLineHeight;
            return `
              <text x="${partsX}" y="${yy}"
                font-size="${partsFontPreferred}" font-weight="600" fill="${SUB_TEXT_COLOR}" font-family="sans-serif">
                ${escapeXml(line)}
              </text>
            `;
          })
          .join('\n');

        const clipId = `card-clip-${index}`;
        const contentSvg = `
          <g clip-path="url(#${clipId})">
            <text x="${x + cardPaddingX}" y="${seibanY}"
              font-size="${seibanFont}" font-weight="700" fill="${TEXT_COLOR}" font-family="sans-serif">
              ${escapeXml(fseiban)}
            </text>
            <text x="${partsX}" y="${labelY}"
              font-size="${labelFont}" font-weight="600" fill="${SUB_TEXT_COLOR}" font-family="sans-serif">
              ${escapeXml(labelText)}
            </text>
            ${partsLinesSvg}

            <text x="${barX}" y="${percentTextY}"
              font-size="${percentFont}" font-weight="700" fill="${accent}" font-family="sans-serif">
              ${escapeXml(`${percent}%`)}
            </text>

            <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${Math.round(barHeight / 2)}" ry="${Math.round(barHeight / 2)}"
              fill="${BAR_BG}" />
            <rect x="${barX}" y="${barY}" width="${fillWidth}" height="${barHeight}" rx="${Math.round(barHeight / 2)}" ry="${Math.round(barHeight / 2)}"
              fill="${accent}" />
          </g>
        `;

        // HTMLのスタイルに合わせて完了カードのopacityを0.7に設定
        const cardOpacity = isCompleted ? 0.7 : 1.0;
        
        return `
          <g opacity="${cardOpacity}">
            <defs>
              <clipPath id="${clipId}">
                <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
                  rx="${Math.round(12 * scale)}" ry="${Math.round(12 * scale)}" />
              </clipPath>
            </defs>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${Math.round(12 * scale)}" ry="${Math.round(12 * scale)}" fill="${CARD_BG}" stroke="${accent}" stroke-width="${Math.max(2, Math.round(2 * scale))}" />
            ${contentSvg}
          </g>
        `;
      })
      .join('\n');

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${BACKGROUND}" />
        <text x="${padding}" y="${titleY}"
          font-size="${titleFont}" font-weight="700" fill="${TEXT_COLOR}" font-family="sans-serif">
          ${escapeXml(title)}
        </text>
        ${kpiInlineSvg}
        ${cardsSvg}
        ${overflowBadgeSvg}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
