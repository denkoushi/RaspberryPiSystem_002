import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, TableVisualizationData, VisualizationData } from '../../visualization.types.js';
import { createMd3Tokens, escapeSvgText } from '../_design-system/index.js';

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

function estimateTextWidth(text: string, fontPx: number): number {
  let usedEm = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    usedEm += code != null && code <= 0xff ? 0.6 : 1.0;
  }
  return Math.round(usedEm * fontPx);
}

function truncateWithEllipsis(text: string, maxWidthPx: number, fontPx: number): string {
  if (!text) return '-';
  if (estimateTextWidth(text, fontPx) <= maxWidthPx) return text;
  const ellipsis = '...';
  let out = '';
  for (const ch of text) {
    const next = out + ch;
    if (estimateTextWidth(next + ellipsis, fontPx) > maxWidthPx) {
      break;
    }
    out = next;
  }
  return out ? `${out}${ellipsis}` : ellipsis;
}

function layoutInstrumentNameLines(params: {
  namesText: string;
  maxWidthPx: number;
  fontPx: number;
  maxLines: number;
}): string[] {
  const { namesText, maxWidthPx, fontPx, maxLines } = params;
  if (maxLines <= 0) {
    return [];
  }
  if (!namesText.trim()) {
    return ['-'];
  }

  const tokens = namesText
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    return ['-'];
  }

  const lines: string[] = [];
  let current = '';
  let consumedAll = true;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const candidate = current ? `${current}, ${token}` : token;
    if (estimateTextWidth(candidate, fontPx) <= maxWidthPx) {
      current = candidate;
      continue;
    }

    if (!current) {
      current = truncateWithEllipsis(token, maxWidthPx, fontPx);
      lines.push(current);
      current = '';
      if (lines.length >= maxLines) {
        consumedAll = i >= tokens.length - 1;
        break;
      }
      continue;
    }

    lines.push(current);
    current = token;
    if (lines.length >= maxLines) {
      consumedAll = false;
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(truncateWithEllipsis(current, maxWidthPx, fontPx));
  } else if (current && lines.length >= maxLines) {
    consumedAll = false;
  }

  if (!consumedAll && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = truncateWithEllipsis(last, maxWidthPx, fontPx);
    if (!lines[lines.length - 1].endsWith('...')) {
      lines[lines.length - 1] = truncateWithEllipsis(`${lines[lines.length - 1]} ...`, maxWidthPx, fontPx);
    }
  }

  return lines;
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
    const headerHeight = Math.round(56 * scale);
    const kpiTop = padding + headerHeight;
    const kpiHeight = Math.round(84 * scale);
    const kpiGap = Math.round(10 * scale);
    const cardsTop = kpiTop + kpiHeight + Math.round(10 * scale);

    const targetDate = typeof metadata.targetDate === 'string' ? metadata.targetDate : '-';

    const kpiItems = [{ value: targetDate, accent: t.colors.text.secondary }];

    const kpiColumns = 4;
    const kpiCardWidth = Math.floor((width - padding * 2 - kpiGap * (kpiColumns - 1)) / kpiColumns);
    const kpiSvg = kpiItems
      .map((item, index) => {
        const x = padding + index * (kpiCardWidth + kpiGap);
        const y = kpiTop;
        return `
          <g>
            <rect x="${x}" y="${y}" width="${kpiCardWidth}" height="${kpiHeight}"
              rx="${Math.round(10 * scale)}" ry="${Math.round(10 * scale)}"
              fill="${t.colors.card.fill}" stroke="${t.colors.card.border}" />
            <text x="${x + Math.round(14 * scale)}" y="${y + Math.round(54 * scale)}"
              font-size="${Math.max(26, Math.round(34 * scale))}" font-weight="700" fill="${item.accent}" font-family="sans-serif">
              ${escapeXml(item.value)}
            </text>
          </g>
        `;
      })
      .join('\n');

    const cardsAreaWidth = width - padding * 2;
    const cardsAreaHeight = height - cardsTop - padding;
    const numColumns = 4;
    const cardGap = Math.round(12 * scale);
    const cardWidth = Math.floor((cardsAreaWidth - cardGap * (numColumns - 1)) / numColumns);
    const cardHeight = Math.round(192 * scale);
    const rowsPerScreen = Math.max(1, Math.floor(cardsAreaHeight / (cardHeight + cardGap)));
    const maxCards = numColumns * rowsPerScreen;
    const allRows = table.rows.slice(0, maxCards);

    const cardsSvg = allRows
      .map((row, index) => {
        const col = index % numColumns;
        const rowIdx = Math.floor(index / numColumns);
        const x = padding + col * (cardWidth + cardGap);
        const y = cardsTop + rowIdx * (cardHeight + cardGap);

        const employeeName = String(row['従業員名'] ?? '-');
        const activeLoanCount = toNumber(row['貸出中計測機器数'], 0);
        const inspected = activeLoanCount > 0;
        const instrumentNamesRaw = String(row['計測機器名称一覧'] ?? '').trim();

        const cardFill = inspected ? t.colors.status.infoContainer : '#020617';
        const cardStroke = inspected ? 'transparent' : t.colors.card.border;
        const primaryText = inspected ? t.colors.status.onInfoContainer : t.colors.text.primary;
        const secondaryText = inspected ? t.colors.status.onInfoContainer : t.colors.text.secondary;
        const namesFontSize = Math.max(12, Math.round(13 * scale));
        const countFontSize = Math.max(13, Math.round(14 * scale));
        const textLeft = x + Math.round(12 * scale);
        const textRight = x + cardWidth - Math.round(12 * scale);
        const headerBaselineY = y + Math.round(34 * scale);
        const namesStartY = y + Math.round(66 * scale);
        const namesBottomY = y + cardHeight - Math.round(12 * scale);
        const lineHeight = Math.max(Math.round(namesFontSize * 1.35), Math.round(18 * scale));
        const maxNameLines = Math.max(1, Math.floor((namesBottomY - namesStartY) / lineHeight) + 1);
        const namesLines = layoutInstrumentNameLines({
          namesText: instrumentNamesRaw,
          maxWidthPx: cardWidth - Math.round(24 * scale),
          fontPx: namesFontSize,
          maxLines: maxNameLines,
        });
        const namesSvg = namesLines
          .map((line, lineIndex) => {
            const lineY = namesStartY + lineIndex * lineHeight;
            return `<text x="${textLeft}" y="${lineY}"
              font-size="${namesFontSize}" font-weight="600" fill="${secondaryText}" font-family="sans-serif">
              ${escapeXml(line)}
            </text>`;
          })
          .join('\n');

        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${Math.round(10 * scale)}" ry="${Math.round(10 * scale)}"
              fill="${cardFill}" stroke="${cardStroke}" />
            <text x="${textLeft}" y="${headerBaselineY}"
              font-size="${Math.max(17, Math.round(19 * scale))}" font-weight="700" fill="${primaryText}" font-family="sans-serif">
              ${escapeXml(employeeName)}
            </text>
            <text x="${textRight}" y="${headerBaselineY}"
              text-anchor="end" font-size="${countFontSize}" font-weight="700" fill="${secondaryText}" font-family="sans-serif">
              計測機器: ${activeLoanCount}
            </text>
            ${namesSvg}
          </g>
        `;
      })
      .join('\n');

    const emptyMessage =
      allRows.length === 0
        ? `<text x="${padding}" y="${cardsTop + Math.round(34 * scale)}"
            font-size="${Math.max(14, Math.round(18 * scale))}" fill="${t.colors.text.secondary}" font-family="sans-serif">
            対象従業員がありません
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
        ${cardsSvg}
        ${emptyMessage}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
