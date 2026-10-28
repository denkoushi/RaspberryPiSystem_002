import sharp from 'sharp';
import { normalizeMachineNameForSignage } from '../../../signage/kiosk-progress-overview/progress-overview-signage-format.js';
import { formatCyclePill } from '../../data-sources/hydraulic-oil-exchange/cycle-date.js';
import type { RenderConfig, RenderOutput, VisualizationData } from '../../visualization.types.js';
import { createMd3Tokens, escapeSvgText } from '../_design-system/index.js';
import type { Renderer } from '../renderer.interface.js';

function textWidth(value: string, fontSize: number): number {
  return [...value].reduce((width, char) => width + (char.codePointAt(0)! <= 0xff ? 0.6 : 1), 0) * fontSize;
}

function ellipsize(value: string, width: number, fontSize: number): string {
  if (textWidth(value, fontSize) <= width) return value;
  let result = '';
  for (const char of value) {
    if (textWidth(`${result}${char}…`, fontSize) > width) break;
    result += char;
  }
  return `${result}…`;
}

export function buildHydraulicOilExchangeSvg(data: VisualizationData, config: RenderConfig): string {
  const { width, height } = config;
  const { colors: c, scale: s, shape } = createMd3Tokens({ width, height });
  const text = (value: unknown, x: number, y: number, size: number, color = c.text.primary, bold = false, anchor = 'start') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${bold ? 700 : 400}" text-anchor="${anchor}">${escapeSvgText(String(value ?? ''))}</text>`;
  const wrap = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="sans-serif">
    <rect width="100%" height="100%" fill="${c.surface.background}"/>${content}</svg>`;
  if (data.kind !== 'table') return wrap(text('可視化データが不正です', width / 2, height / 2, 40 * s, c.text.primary, false, 'middle'));
  if (data.metadata?.error) {
    return wrap(text(`データ取得エラー: ${data.metadata.error}`, width / 2, height / 2, 32 * s, c.text.primary, false, 'middle'));
  }
  const padding = 40 * s;
  const columns = data.rows.length <= 12 ? 4 : data.rows.length <= 24 ? 6 : 8;
  const rowCount = columns === 4 ? 3 : columns === 6 ? 4 : 6;
  const cardScale = s * 4 / columns;
  const gap = 20 * cardScale;
  const top = 140 * s;
  const cardWidth = (width - padding * 2 - gap * (columns - 1)) / columns;
  const cardHeight = (height - top - padding - gap * (rowCount - 1)) / rowCount;
  const counts = (data.metadata?.counts ?? {}) as Record<string, number>;
  const chips = [
    { state: 'overdue', label: '超過', color: c.status.error },
    { state: 'soon', label: '30日以内', color: c.status.warning },
    { state: 'ok', label: '余裕あり', color: c.status.success },
  ].map((chip, index) => {
    const x = width - padding - (3 - index) * 218 * s;
    return `<rect x="${x}" y="${42 * s}" width="${200 * s}" height="${48 * s}" rx="${24 * s}" fill="${c.surface.containerHigh}"/>`
      + text(`${counts[chip.state] ?? 0} ${chip.label}`, x + 100 * s, 74 * s, 24 * s, chip.color, true, 'middle');
  }).join('');
  const header = text('作動油交換', padding, 85 * s, 52 * s, c.text.primary, true)
    + text(String(data.metadata?.today ?? '').replaceAll('-', '/'), padding + 310 * s, 83 * s, 30 * s, c.text.secondary) + chips;
  if (data.rows.length === 0) {
    return wrap(header + text('作動油交換の記録はありません', width / 2, height / 2, 40 * s, c.text.secondary, false, 'middle'));
  }
  const cards = data.rows.slice(0, 48).map((row, index) => {
    const x = padding + (index % columns) * (cardWidth + gap);
    const y = top + Math.floor(index / columns) * (cardHeight + gap);
    const inset = 24 * cardScale;
    const left = x + inset;
    const right = x + cardWidth - inset;
    const isNone = row.state === 'none';
    const color = row.state === 'overdue' ? c.status.error : row.state === 'soon' ? c.status.warning : row.state === 'ok' ? c.status.success : c.outline;
    const cycle = ellipsize(formatCyclePill(String(row.cycle ?? '')) || '—', 100 * cardScale, 23 * cardScale);
    const pillWidth = Math.max(66 * cardScale, textWidth(cycle, 23 * cardScale) + 24 * cardScale);
    const nameWidth = cardWidth - inset * 2 - (isNone ? 0 : pillWidth + 12 * cardScale);
    const name = ellipsize(normalizeMachineNameForSignage(String(row.machineName ?? '')), nameWidth, width * 0.023 * cardScale / s);
    const subText = [row.equipmentManagementNumber, row.subText].filter(Boolean).join('・');
    const dates = isNone ? '' : text(String(row.lastDate ?? '—').replaceAll('-', '/'), left, y + cardHeight - 26 * cardScale, 23 * cardScale, c.text.secondary)
      + text(`→ ${String(row.nextDate ?? '—').replaceAll('-', '/')}`, right, y + cardHeight - 26 * cardScale, 23 * cardScale, row.state === 'overdue' ? c.status.error : c.text.primary, true, 'end');
    const remaining = typeof row.remainingDays === 'number' ? row.remainingDays : null;
    const numberY = y + cardHeight * 0.64;
    const number = isNone ? text('次回から', left, numberY, (columns === 4 ? 48 : 40) * cardScale, c.text.secondary, true)
      : remaining === null ? text('—', left, numberY, 80 * cardScale, c.outline, true)
      : `<text x="${left}" y="${numberY}" fill="${color}">${remaining >= 0 ? `<tspan font-size="${30 * cardScale}" fill="${c.text.secondary}">あと </tspan>` : ''}<tspan font-size="${Math.min(80 * cardScale, (cardWidth - inset * 2 - 110 * cardScale) / (String(Math.abs(remaining)).length * 0.6))}" font-weight="700">${Math.abs(remaining)}</tspan><tspan font-size="${30 * cardScale}"> ${remaining < 0 ? '日超過' : '日'}</tspan></text>`;
    return `<g data-card="${index}">
      <rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="${shape.radiusLg * cardScale / s}" fill="${c.card.fill}" stroke="${c.card.border}"/>
      ${row.state === 'overdue' ? `<rect x="${x}" y="${y}" width="${cardWidth}" height="${cardHeight}" rx="${shape.radiusLg * cardScale / s}" fill="${c.status.errorContainer}" fill-opacity="0.18"/>` : ''}
      <rect x="${x}" y="${y + 16 * cardScale}" width="${6 * cardScale}" height="${cardHeight - 32 * cardScale}" rx="${3 * cardScale}" fill="${color}"/>
      ${isNone ? '' : `<rect x="${right - pillWidth}" y="${y + 20 * cardScale}" width="${pillWidth}" height="${38 * cardScale}" rx="${19 * cardScale}" fill="${c.surface.containerHighest}"/>`
        + text(cycle, right - pillWidth / 2, y + 47 * cardScale, 23 * cardScale, c.text.secondary, true, 'middle')}
      ${text(name, left, y + 57 * cardScale, width * 0.023 * cardScale / s, c.text.primary, true)}
      ${columns === 8 ? '' : text(ellipsize(subText, cardWidth - inset * 2, 22 * cardScale), left, y + 90 * cardScale, 22 * cardScale, c.text.secondary)}
      ${number}${dates}</g>`;
  }).join('');
  return wrap(header + cards);
}

export class HydraulicOilExchangeRenderer implements Renderer {
  readonly type = 'hydraulic_oil_exchange';

  async render(data: VisualizationData, config: RenderConfig): Promise<RenderOutput> {
    const svg = buildHydraulicOilExchangeSvg(data, config);
    const buffer = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    return { buffer, contentType: 'image/jpeg' };
  }
}
