import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { KpiVisualizationData, RenderConfig, RenderOutput, VisualizationData } from '../../visualization.types.js';
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

export class KpiCardsRenderer implements Renderer {
  readonly type = 'kpi_cards';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    if (data.kind !== 'kpi') {
      const svg = buildMessageSvg('可視化データが不正です', config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const kpiData = data as KpiVisualizationData;
    const width = config.width;
    const height = config.height;
    const title = config.title ?? '可視化';

    const t = createMd3Tokens({ width, height });
    const goodColor = config.colors?.good ?? t.colors.status.success;
    const badColor = config.colors?.bad ?? t.colors.status.error;
    const neutralColor = config.colors?.neutral ?? t.colors.status.info;

    const scale = t.scale;
    const padding = Math.round(24 * scale);
    const headerHeight = Math.round(72 * scale);
    const cardGap = Math.round(16 * scale);
    const cardRadius = Math.round(14 * scale);

    const items = kpiData.items ?? [];
    const columns = Math.min(items.length || 1, 3);
    const rows = Math.max(1, Math.ceil(items.length / columns));

    const cardWidth = Math.floor((width - padding * 2 - cardGap * (columns - 1)) / columns);
    const cardHeight = Math.floor((height - padding * 2 - headerHeight - cardGap * (rows - 1)) / rows);

    const cardsSvg = items
      .map((item, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = padding + column * (cardWidth + cardGap);
        const y = padding + headerHeight + row * (cardHeight + cardGap);

        const accent = item.isGood === true ? goodColor : item.isGood === false ? badColor : neutralColor;
        const valueText = `${item.value}${item.unit ?? ''}`;
        const labelFont = Math.max(16, Math.round(20 * scale));
        const valueFont = Math.max(24, Math.round(36 * scale));
        const noteFont = Math.max(12, Math.round(16 * scale));

        return `
          <g>
            <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}"
              rx="${cardRadius}" ry="${cardRadius}" fill="${t.colors.card.fill}" stroke="${accent}" stroke-width="${Math.max(2, Math.round(2 * scale))}" />
            <text x="${x + Math.round(16 * scale)}" y="${y + Math.round(30 * scale)}"
              font-size="${labelFont}" font-weight="600" fill="${t.colors.text.primary}" font-family="sans-serif">
              ${escapeXml(item.label)}
            </text>
            <text x="${x + Math.round(16 * scale)}" y="${y + Math.round(70 * scale)}"
              font-size="${valueFont}" font-weight="700" fill="${accent}" font-family="sans-serif">
              ${escapeXml(valueText)}
            </text>
            ${
              item.note
                ? `<text x="${x + Math.round(16 * scale)}" y="${y + Math.round(100 * scale)}"
                    font-size="${noteFont}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">
                    ${escapeXml(item.note)}
                  </text>`
                : ''
            }
          </g>
        `;
      })
      .join('\n');

    const emptySvg = `
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        font-size="${Math.max(24, Math.round(28 * scale))}" font-weight="600" fill="${t.colors.text.primary}" font-family="sans-serif">
        表示データがありません
      </text>
    `;

    const svg = `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
        <text x="${padding}" y="${padding + Math.round(36 * scale)}"
          font-size="${Math.max(20, Math.round(28 * scale))}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">
          ${escapeXml(title)}
        </text>
        ${items.length > 0 ? cardsSvg : emptySvg}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
