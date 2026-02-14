import sharp from 'sharp';
import type { Renderer } from '../renderer.interface.js';
import type { RenderConfig, RenderOutput, SeriesVisualizationData, VisualizationData } from '../../visualization.types.js';
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

export class BarChartRenderer implements Renderer {
  readonly type = 'bar_chart';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    if (data.kind !== 'series') {
      const svg = buildMessageSvg('可視化データが不正です', config.width, config.height);
      const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
      return { buffer, contentType: 'image/jpeg' };
    }

    const series = data as SeriesVisualizationData;
    const width = config.width;
    const height = config.height;
    const title = config.title ?? '可視化';
    const t = createMd3Tokens({ width, height });
    const scale = t.scale;

    const padding = Math.round(24 * scale);
    const headerHeight = Math.round(72 * scale);
    const chartHeight = height - padding * 2 - headerHeight;
    const chartWidth = width - padding * 2;
    const labelWidth = Math.round(320 * scale);
    const barAreaWidth = chartWidth - labelWidth;
    const barGap = Math.max(8, Math.round(10 * scale));

    const dataset = series.datasets[0];
    const values = dataset ? dataset.values : [];
    const labels = series.labels ?? [];
    const maxValue = Math.max(1, ...values);

    const barHeight = Math.max(22, Math.floor((chartHeight - barGap * Math.max(0, values.length - 1)) / Math.max(values.length, 1)));
    const barColor =
      dataset?.isGood === false ? (config.colors?.bad ?? t.colors.status.error) : (config.colors?.good ?? t.colors.status.info);

    const barsSvg = values
      .map((value, index) => {
        const x = padding + labelWidth;
        const y = padding + headerHeight + index * (barHeight + barGap);
        const barWidth = Math.max(4, Math.round((value / maxValue) * barAreaWidth));
        const label = labels[index] ?? '';
        const valueText = `${value}`;
        const labelFont = Math.max(14, Math.round(18 * scale));
        const valueFont = Math.max(12, Math.round(16 * scale));

        return `
          <g>
            <text x="${padding}" y="${y + Math.round(barHeight * 0.7)}"
              font-size="${labelFont}" font-weight="600" fill="${t.colors.text.primary}" font-family="sans-serif">
              ${escapeXml(label)}
            </text>
            <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}"
              rx="${Math.round(8 * scale)}" ry="${Math.round(8 * scale)}" fill="${barColor}" />
            <text x="${x + barWidth + Math.round(12 * scale)}" y="${y + Math.round(barHeight * 0.7)}"
              font-size="${valueFont}" font-weight="600" fill="${t.colors.text.primary}" font-family="sans-serif">
              ${escapeXml(valueText)}
            </text>
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
        ${values.length > 0 ? barsSvg : emptySvg}
      </svg>
    `;

    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
