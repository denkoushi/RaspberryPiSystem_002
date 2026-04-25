import type { Md3Tokens } from '../_design-system/md3.js';
import type { PalletBoardVisualizationData } from '../../visualization.types.js';
import { escapeSvgText } from '../_design-system/index.js';

export function buildMultiMachinePalletBoardSvg(params: {
  width: number;
  height: number;
  t: Md3Tokens;
  title: string;
  subtitle: string;
  pageMachines: PalletBoardVisualizationData['machines'];
}): string {
  const { width, height, t, title, subtitle, pageMachines } = params;
  const margin = Math.round(Math.min(width, height) * 0.02);
  const headerH = Math.round(height * 0.08);
  const gridTop = margin + headerH;
  const gridHeight = height - gridTop - margin;
  const cols = pageMachines.length <= 2 ? pageMachines.length || 1 : pageMachines.length <= 4 ? 2 : 3;
  const rows = Math.ceil(pageMachines.length / cols) || 1;
  const cellW = (width - margin * 2) / cols;
  const cellH = gridHeight / rows;

  const cards: string[] = [];
  for (let i = 0; i < pageMachines.length; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * cellW;
    const y = gridTop + row * cellH;
    const m = pageMachines[i];
    if (!m) continue;

    const pad = Math.round(Math.min(cellW, cellH) * 0.04);
    const titleSize = Math.max(12, Math.round(cellW / 28));
    const bodySize = Math.max(10, Math.round(cellW / 32));
    const innerW = cellW - pad * 2;
    const innerH = cellH - pad * 2;
    const headerBoxH = Math.round(innerH * 0.12);

    const palletCols = 5;
    const palletN = m.pallets.length;
    const palletRows = Math.max(1, Math.ceil(palletN / palletCols));
    const slotW = innerW / palletCols;
    const slotH = (innerH - headerBoxH) / palletRows;

    const palletBlocks: string[] = [];
    for (let pi = 0; pi < palletN; pi += 1) {
      const pc = pi % palletCols;
      const pr = Math.floor(pi / palletCols);
      const sx = x + pad + pc * slotW;
      const sy = y + pad + headerBoxH + pr * slotH;
      const slot = m.pallets[pi];
      const palletNo = slot?.palletNo ?? pi + 1;
      const lines = slot?.lines ?? [];
      const preview = lines.slice(0, 3).join(' / ') || '—';
      const more = lines.length > 3 ? ` +${lines.length - 3}` : '';

      palletBlocks.push(`
          <rect x="${sx + 2}" y="${sy + 2}" width="${slotW - 4}" height="${slotH - 4}" rx="6" fill="${t.colors.surface.containerHigh}" stroke="${t.colors.grid}" stroke-width="1" />
          <text x="${sx + 8}" y="${sy + 8 + bodySize}" font-size="${bodySize}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(`#${palletNo}`)}</text>
          <text x="${sx + 8}" y="${sy + 8 + bodySize * 2.4}" font-size="${bodySize * 0.85}" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(preview + more)}</text>
        `);
    }

    cards.push(`
        <rect x="${x + pad}" y="${y + pad}" width="${innerW}" height="${innerH}" rx="12" fill="${t.colors.surface.background}" stroke="${t.colors.outline}" stroke-width="2" />
        <rect x="${x + pad}" y="${y + pad}" width="${innerW}" height="${headerBoxH}" rx="10" fill="${t.colors.status.infoContainer}" />
        <text x="${x + pad + 10}" y="${y + pad + headerBoxH * 0.65}" font-size="${titleSize}" font-weight="700" fill="${t.colors.status.onInfoContainer}" font-family="sans-serif">
          ${escapeSvgText(`${m.machineName} (${m.machineCd})`)}
        </text>
        ${palletBlocks.join('')}
      `);
  }

  return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
        <text x="${margin}" y="${margin + headerH * 0.55}" font-size="${Math.round(headerH * 0.45)}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">
          ${escapeSvgText(title)}
        </text>
        ${
          subtitle
            ? `<text x="${width - margin}" y="${margin + headerH * 0.55}" text-anchor="end" font-size="${Math.round(headerH * 0.35)}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(subtitle)}</text>`
            : ''
        }
        ${cards.join('')}
      </svg>
    `;
}
