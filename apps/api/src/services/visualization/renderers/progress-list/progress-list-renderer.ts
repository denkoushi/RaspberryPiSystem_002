import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';

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

function estimateMaxCharsPerLine(availableWidthPx: number, fontPx: number): number {
  // SVGのsans-serifを前提とした雑な近似。見積りがズレても、最終的に…で破綻を防ぐ。
  const approxCharWidth = Math.max(6, fontPx * 0.55);
  return Math.max(6, Math.floor(availableWidthPx / approxCharWidth));
}

function wrapCommaSeparatedToLines(
  text: string,
  maxCharsPerLine: number,
  maxLines: number
): { lines: string[]; truncated: boolean } {
  const normalized = text.trim();
  if (!normalized) return { lines: [''], truncated: false };

  // 例: "部品A, 部品B, 部品C" を優先的に分割し、行長の見積り内に収める
  const tokens = normalized
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  // カンマが無い/分割できない場合はフォールバック（文字数で強制分割）
  if (tokens.length <= 1) {
    const raw: string[] = [];
    let rest = normalized;
    while (rest.length > 0) {
      raw.push(rest.slice(0, maxCharsPerLine));
      rest = rest.slice(maxCharsPerLine);
      if (raw.length >= maxLines) break;
    }
    const truncated = rest.length > 0;
    return { lines: raw, truncated };
  }

  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const next = current.length === 0 ? token : `${current}, ${token}`;
    if (next.length <= maxCharsPerLine || current.length === 0) {
      current = next;
      continue;
    }
    lines.push(current);
    current = token;
    if (lines.length >= maxLines) break;
  }
  if (lines.length < maxLines) {
    lines.push(current);
  }

  const allJoinedCount = tokens.join(', ').length;
  const usedJoinedCount = lines.join(', ').length;
  const truncated = usedJoinedCount < allJoinedCount;
  return { lines: lines.slice(0, maxLines), truncated };
}

function fitAndWrapPartsText(options: {
  isCompleted: boolean;
  incompleteParts: string;
  availableWidthPx: number;
  preferredFontPx: number;
  minFontPx: number;
  maxLines: number;
}): { fontPx: number; lines: string[] } {
  const label = options.isCompleted ? '未完部品: なし' : '未完部品:';
  const body = options.isCompleted ? '' : (options.incompleteParts || '(不明)');

  // 先頭行にラベル+本文を詰め、残り行で続き（必要なら…）
  // NOTE: 省略せずに収めたい要求があるが、最終的に読めない状態は避けるため…を許容する。
  let fontPx = options.preferredFontPx;
  for (; fontPx >= options.minFontPx; fontPx -= 1) {
    const maxChars = estimateMaxCharsPerLine(options.availableWidthPx, fontPx);
    if (options.isCompleted) {
      const line = truncateText(label, maxChars);
      return { fontPx, lines: [line] };
    }

    const firstCandidate = `${label} ${body}`.trim();
    const wrapped = wrapCommaSeparatedToLines(firstCandidate, maxChars, options.maxLines);
    if (!wrapped.truncated && wrapped.lines.length <= options.maxLines) {
      return { fontPx, lines: wrapped.lines };
    }
  }

  // 下限でも収まらない場合は最後の行を…で切る
  const maxChars = estimateMaxCharsPerLine(options.availableWidthPx, options.minFontPx);
  if (options.isCompleted) {
    return { fontPx: options.minFontPx, lines: [truncateText(label, maxChars)] };
  }
  const fallback = wrapCommaSeparatedToLines(`${label} ${body}`.trim(), maxChars, options.maxLines);
  const lines = fallback.lines.slice(0, options.maxLines);
  if (lines.length > 0 && fallback.truncated) {
    lines[lines.length - 1] = truncateText(lines[lines.length - 1], Math.max(6, maxChars));
  }
  return { fontPx: options.minFontPx, lines };
}

function buildKpiInlineSvg(options: {
  xRight: number;
  yBaseline: number;
  scale: number;
  stats: Array<{ label: string; value: string; color: string }>;
}): string {
  // タイトル右横に横並び。文字数が増えても壊れないよう、右寄せで詰めていく。
  const chipGap = Math.round(12 * options.scale);
  const chipPaddingX = Math.round(10 * options.scale);
  const chipPaddingY = Math.round(6 * options.scale);
  const labelFont = Math.max(14, Math.round(16 * options.scale));
  const valueFont = Math.max(18, Math.round(22 * options.scale));
  const chipHeight = Math.round(valueFont * 1.2) + chipPaddingY * 2;

  let cursorRight = options.xRight;
  const chips: string[] = [];

  for (let i = options.stats.length - 1; i >= 0; i -= 1) {
    const stat = options.stats[i]!;
    const text = `${stat.label} ${stat.value}`;
    const approxWidth = Math.round(text.length * valueFont * 0.55) + chipPaddingX * 2;
    const chipWidth = Math.max(Math.round(92 * options.scale), approxWidth);
    const x = cursorRight - chipWidth;
    const y = options.yBaseline - Math.round(22 * options.scale) - chipPaddingY;

    chips.push(`
      <g>
        <rect x="${x}" y="${y}" width="${chipWidth}" height="${chipHeight}"
          rx="${Math.round(10 * options.scale)}" ry="${Math.round(10 * options.scale)}"
          fill="rgba(255,255,255,0.05)" stroke="${BORDER_COLOR}" stroke-width="${Math.max(1, Math.round(2 * options.scale))}" />
        <text x="${x + chipPaddingX}" y="${y + chipPaddingY + Math.round(valueFont * 0.95)}"
          font-size="${labelFont}" font-weight="600" fill="${SUB_TEXT_COLOR}" font-family="sans-serif">
          ${escapeXml(stat.label)}
        </text>
        <text x="${x + chipPaddingX + Math.round(stat.label.length * labelFont * 0.55) + Math.round(6 * options.scale)}"
          y="${y + chipPaddingY + Math.round(valueFont * 0.95)}"
          font-size="${valueFont}" font-weight="800" fill="${stat.color}" font-family="sans-serif">
          ${escapeXml(stat.value)}
        </text>
      </g>
    `);

    cursorRight = x - chipGap;
  }

  return chips.reverse().join('\n');
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
    const title = config.title ?? '生産スケジュール進捗状況';
    const rows = table.rows ?? [];

    if (rows.length === 0) {
      const svg = buildMessageSvg('登録製番がありません', width, height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const scale = width / 1920;
    const padding = Math.round(24 * scale);
    const headerHeight = Math.round(84 * scale);
    const gap = Math.round(24 * scale);

    const totalSeibanCount = rows.length;
    const totalParts = rows.reduce((sum, row) => sum + (toNumber(row.total) ?? 0), 0);
    const completedParts = rows.reduce((sum, row) => sum + (toNumber(row.completed) ?? 0), 0);
    const progressRate = totalParts > 0 ? Math.round((completedParts / totalParts) * 100) : 0;

    const columnsRaw = toNumber(config.columns);
    const fixedColumns = columnsRaw != null ? clampNumber(columnsRaw, 1, 4) : null;

    const gridTop = padding + headerHeight + gap;
    const gridHeight = height - gridTop - padding;
    const cardGap = Math.round(24 * scale);

    // 可読性下限（ユーザー指定）を守りつつ、可能な限り表示数を増やす
    const minPrimaryFont = 18;
    const minPartsFont = 14;
    const minCardWidth = Math.round(360 * scale);
    const minCardHeight = Math.round(210 * scale);

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

    const kpiInlineSvg = buildKpiInlineSvg({
      xRight: width - padding,
      yBaseline: padding + Math.round(40 * scale),
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

        // カードが小さくなる場合でも下限を守る
        const cardScale = Math.min(1, cardWidth / Math.round(540 * scale), cardHeight / Math.round(260 * scale));
        const effectiveScale = scale * cardScale;

        const seibanFont = Math.max(minPrimaryFont, Math.round(32 * effectiveScale));
        const partsFontPreferred = Math.max(minPartsFont, Math.round(18 * effectiveScale));
        const percentFont = Math.max(minPrimaryFont, Math.round(22 * effectiveScale));
        const barHeight = Math.max(10, Math.round(16 * effectiveScale)); // 以前の約半分
        const barWidth = Math.floor(cardWidth - Math.round(32 * scale));
        const barX = x + Math.round(16 * scale);
        const barY = y + cardHeight - Math.round(20 * scale) - barHeight;

        const fillWidth = Math.round((barWidth * clampNumber(percent, 0, 100)) / 100);
        const partsAvailableWidth = Math.max(1, cardWidth - Math.round(32 * scale));
        const partsFit = fitAndWrapPartsText({
          isCompleted,
          incompleteParts,
          availableWidthPx: partsAvailableWidth,
          preferredFontPx: partsFontPreferred,
          minFontPx: minPartsFont,
          maxLines: 3,
        });
        const partsLineHeight = Math.round(partsFit.fontPx * 1.25);
        const partsStartY = y + Math.round(72 * scale);
        const partsX = x + Math.round(16 * scale);
        const partsLinesSvg = partsFit.lines
          .slice(0, 3)
          .map((line, i) => {
            const yy = partsStartY + i * partsLineHeight;
            return `
              <text x="${partsX}" y="${yy}"
                font-size="${partsFit.fontPx}" font-weight="600" fill="${SUB_TEXT_COLOR}" font-family="sans-serif">
                ${escapeXml(line)}
              </text>
            `;
          })
          .join('\n');

        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${Math.round(12 * scale)}" ry="${Math.round(12 * scale)}" fill="${CARD_BG}" stroke="${accent}" stroke-width="${Math.max(2, Math.round(2 * scale))}" />
            <text x="${x + Math.round(16 * scale)}" y="${y + Math.round(36 * scale)}"
              font-size="${seibanFont}" font-weight="700" fill="${TEXT_COLOR}" font-family="sans-serif">
              ${escapeXml(fseiban)}
            </text>
            ${partsLinesSvg}

            <text x="${barX}" y="${barY - Math.round(8 * scale)}"
              font-size="${percentFont}" font-weight="700" fill="${accent}" font-family="sans-serif">
              ${escapeXml(`${percent}%`)}
            </text>

            <rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${Math.round(barHeight / 2)}" ry="${Math.round(barHeight / 2)}"
              fill="${BAR_BG}" />
            <rect x="${barX}" y="${barY}" width="${fillWidth}" height="${barHeight}" rx="${Math.round(barHeight / 2)}" ry="${Math.round(barHeight / 2)}"
              fill="${accent}" />
          </g>
        `;
      })
      .join('\n');

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${BACKGROUND}" />
        <text x="${padding}" y="${padding + Math.round(40 * scale)}"
          font-size="${Math.max(28, Math.round(48 * scale))}" font-weight="700" fill="${TEXT_COLOR}" font-family="sans-serif">
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
