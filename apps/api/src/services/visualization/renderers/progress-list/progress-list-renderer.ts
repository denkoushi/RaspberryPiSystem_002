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

function badgeTextColorForAccent(accent: string): string {
  // 明るい背景色（緑/黄）は黒文字の方が視認性が高い
  if (accent === COMPLETE_COLOR || accent === PROGRESS_YELLOW) return '#020617';
  return TEXT_COLOR;
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
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
    const headerHeight = Math.round(72 * scale);
    const statsHeight = Math.round(100 * scale);
    const gap = Math.round(24 * scale);

    const totalSeibanCount = rows.length;
    const totalParts = rows.reduce((sum, row) => sum + (toNumber(row.total) ?? 0), 0);
    const completedParts = rows.reduce((sum, row) => sum + (toNumber(row.completed) ?? 0), 0);
    const progressRate = totalParts > 0 ? Math.round((completedParts / totalParts) * 100) : 0;

    const columnsRaw = toNumber(config.columns);
    const columns = clampNumber(columnsRaw ?? (width >= 1600 ? 2 : 1), 1, 4);

    const gridTop = padding + headerHeight + statsHeight + gap;
    const gridHeight = height - gridTop - padding;
    const rowsCount = Math.max(1, Math.ceil(rows.length / columns));
    const cardGap = Math.round(24 * scale);
    const cardWidth = Math.floor((width - padding * 2 - cardGap * (columns - 1)) / columns);
    const cardHeight = Math.floor((gridHeight - cardGap * (rowsCount - 1)) / rowsCount);

    const statsCardGap = Math.round(16 * scale);
    const statsCardWidth = Math.floor((width - padding * 2 - statsCardGap * 3) / 4);

    const stats = [
      { label: '総製番数', value: String(totalSeibanCount), color: NEUTRAL_COLOR },
      { label: '総部品数', value: String(totalParts), color: NEUTRAL_COLOR },
      { label: '完了部品数', value: String(completedParts), color: COMPLETE_COLOR },
      { label: '進捗率', value: `${progressRate}%`, color: NEUTRAL_COLOR },
    ];

    const statsSvg = stats
      .map((stat, index) => {
        const x = padding + index * (statsCardWidth + statsCardGap);
        const y = padding + headerHeight;
        const labelFont = Math.max(18, Math.round(20 * scale));
        const valueFont = Math.max(28, Math.round(36 * scale));
        return `
          <g>
            <rect x="${x}" y="${y}" width="${statsCardWidth}" height="${statsHeight}"
              rx="${Math.round(12 * scale)}" ry="${Math.round(12 * scale)}" fill="${CARD_BG}" stroke="${BORDER_COLOR}" stroke-width="${Math.max(2, Math.round(2 * scale))}" />
            <text x="${x + Math.round(20 * scale)}" y="${y + Math.round(32 * scale)}"
              font-size="${labelFont}" font-weight="600" fill="${SUB_TEXT_COLOR}" font-family="sans-serif">
              ${escapeXml(stat.label)}
            </text>
            <text x="${x + Math.round(20 * scale)}" y="${y + Math.round(72 * scale)}"
              font-size="${valueFont}" font-weight="700" fill="${stat.color}" font-family="sans-serif">
              ${escapeXml(stat.value)}
            </text>
          </g>
        `;
      })
      .join('\n');

    const cardsSvg = rows
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
        const badgeTextColor = badgeTextColorForAccent(accent);

        const seibanFont = Math.max(24, Math.round(32 * scale));
        const statusFont = Math.max(14, Math.round(18 * scale));
        const partsFont = Math.max(14, Math.round(18 * scale));
        const percentFont = Math.max(18, Math.round(22 * scale));
        const barHeight = Math.max(20, Math.round(32 * scale));
        const barWidth = Math.floor(cardWidth - Math.round(32 * scale));
        const barX = x + Math.round(16 * scale);
        const barY = y + cardHeight - Math.round(20 * scale) - barHeight;

        const badgePaddingX = Math.round(10 * scale);
        const badgeTextWidth = Math.round(status.length * statusFont * 0.6) + badgePaddingX * 2;

        const fillWidth = Math.round((barWidth * clampNumber(percent, 0, 100)) / 100);
        const partsLabel = isCompleted ? '未完部品: なし' : `未完部品: ${incompleteParts || '(不明)'}`;
        const partsText = truncateText(partsLabel, Math.max(24, Math.round(cardWidth / (partsFont * 0.55))));

        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${Math.round(12 * scale)}" ry="${Math.round(12 * scale)}" fill="${CARD_BG}" stroke="${accent}" stroke-width="${Math.max(2, Math.round(2 * scale))}" />
            <text x="${x + Math.round(16 * scale)}" y="${y + Math.round(36 * scale)}"
              font-size="${seibanFont}" font-weight="700" fill="${TEXT_COLOR}" font-family="sans-serif">
              ${escapeXml(fseiban)}
            </text>
            <rect x="${x + cardWidth - badgeTextWidth - Math.round(16 * scale)}" y="${y + Math.round(16 * scale)}"
              width="${badgeTextWidth}" height="${Math.round(statusFont * 1.6)}" rx="${Math.round(8 * scale)}" ry="${Math.round(8 * scale)}"
              fill="${accent}" />
            <text x="${x + cardWidth - badgeTextWidth - Math.round(16 * scale) + badgePaddingX}" y="${y + Math.round(16 * scale) + Math.round(statusFont * 1.2)}"
              font-size="${statusFont}" font-weight="700" fill="${badgeTextColor}" font-family="sans-serif">
              ${escapeXml(status)}
            </text>

            <text x="${x + Math.round(16 * scale)}" y="${y + Math.round(72 * scale)}"
              font-size="${partsFont}" font-weight="600" fill="${SUB_TEXT_COLOR}" font-family="sans-serif">
              ${escapeXml(partsText)}
            </text>

            <text x="${barX}" y="${barY - Math.round(10 * scale)}"
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
        ${statsSvg}
        ${cardsSvg}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
