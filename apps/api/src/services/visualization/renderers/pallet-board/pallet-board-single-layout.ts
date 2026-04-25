import type { Md3Tokens } from '../_design-system/md3.js';
import type { PalletBoardVisualizationData } from '../../visualization.types.js';
import { escapeSvgText } from '../_design-system/index.js';
import { palletBoardFixtureInnerSvg } from './pallet-board-fixture-svg.js';

const EM_DASH = '—';

function dashOr(value: string | null | undefined): string {
  const s = value?.trim();
  return s && s.length > 0 ? s : EM_DASH;
}

function qtyLabel(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) {
    return EM_DASH;
  }
  return `${Math.round(q)} 個`;
}

function isSlotEmpty(slot: PalletBoardVisualizationData['machines'][number]['pallets'][number]): boolean {
  if (slot.isEmpty === true) {
    return true;
  }
  if (slot.primaryItem) {
    return false;
  }
  return slot.lines.length === 0;
}

export function buildSingleMachinePalletBoardSvg(params: {
  width: number;
  height: number;
  t: Md3Tokens;
  title: string;
  subtitle: string;
  machine: PalletBoardVisualizationData['machines'][number];
}): string {
  const { width, height, t, title, subtitle, machine } = params;
  const margin = Math.round(Math.min(width, height) * 0.02);
  const headerH = Math.round(height * 0.07);
  const contentTop = margin + headerH;
  const contentH = height - contentTop - margin;
  const contentW = width - margin * 2;
  const splitGap = Math.round(Math.min(width, height) * 0.015);
  const leftW = Math.round(contentW * 0.25) - splitGap / 2;
  const rightW = contentW - leftW - splitGap;
  const leftX = margin;
  const rightX = margin + leftW + splitGap;

  const pallets = machine.pallets;
  const palletCols = 5;
  const palletRows = Math.max(1, Math.ceil(pallets.length / palletCols));
  const slotW = rightW / palletCols;
  const slotH = contentH / palletRows;

  const titleFont = Math.round(headerH * 0.42);
  const subFont = Math.round(headerH * 0.32);

  const heroTitle = `${machine.machineName} (${machine.machineCd})`;
  const heroNote = machine.illustrationUrl ? 'PalletMachineIllustration（登録あり）' : 'PalletMachineIllustration（未登録）';

  const slotsSvg = pallets.map((slot, idx) => renderSlot({ slot, idx, palletCols, contentTop, rightX, slotW, slotH, t })).join('');

  return `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="pbEmptyGray" x="-10%" y="-10%" width="120%" height="120%">
        <feColorMatrix type="saturate" values="0.35" />
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="${t.colors.surface.background}" />
    <text x="${margin}" y="${margin + headerH * 0.55}" font-size="${titleFont}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(title)}</text>
    ${
      subtitle
        ? `<text x="${width - margin}" y="${margin + headerH * 0.55}" text-anchor="end" font-size="${subFont}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(subtitle)}</text>`
        : ''
    }

    <rect x="${leftX}" y="${contentTop}" width="${leftW}" height="${contentH}" rx="12"
      fill="${t.colors.surface.containerHigh}" stroke="${t.colors.outline}" stroke-width="2" />
    <text x="${leftX + 14}" y="${contentTop + 36}" font-size="${Math.max(14, Math.round(leftW / 18))}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(heroTitle)}</text>
    <text x="${leftX + 14}" y="${contentTop + 62}" font-size="${Math.max(11, Math.round(leftW / 22))}" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(heroNote)}</text>
    <rect x="${leftX + 14}" y="${contentTop + 76}" width="${leftW - 28}" height="${contentH - 90}" rx="10"
      fill="rgba(0,0,0,0.25)" stroke="${t.colors.grid}" stroke-width="1" />
    <text x="${leftX + leftW / 2}" y="${contentTop + 76 + (contentH - 90) / 2}" text-anchor="middle" dominant-baseline="middle"
      font-size="${Math.max(16, Math.round(leftW / 12))}" font-weight="600" fill="${t.colors.text.secondary}" font-family="sans-serif">機械イラスト</text>

    ${slotsSvg}
  </svg>`;
}

function renderSlot(params: {
  slot: PalletBoardVisualizationData['machines'][number]['pallets'][number];
  idx: number;
  palletCols: number;
  contentTop: number;
  rightX: number;
  slotW: number;
  slotH: number;
  t: Md3Tokens;
}): string {
  const { slot, idx, palletCols, contentTop, rightX, slotW, slotH, t } = params;
  const pc = idx % palletCols;
  const pr = Math.floor(idx / palletCols);
  const sx = rightX + pc * slotW;
  const sy = contentTop + pr * slotH;

  const pad = Math.max(6, Math.round(Math.min(slotW, slotH) * 0.035));
  const innerW = slotW - pad * 2;
  const innerH = slotH - pad * 2;
  const bx = sx + pad;
  const by = sy + pad;
  const isEmpty = isSlotEmpty(slot);
  const strokeColor = isEmpty ? 'rgba(255,255,255,0.12)' : t.colors.status.success;
  const fillColor = isEmpty ? 'rgba(255,255,255,0.04)' : 'rgba(46, 125, 50, 0.15)';
  const thumbW = Math.round(innerW * 0.3);
  const thumbH = Math.round(innerH * 0.34);
  const bodyX = bx + thumbW + 10;

  const baseRect = `<rect x="${bx}" y="${by}" width="${innerW}" height="${innerH}" rx="10" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" ${
    isEmpty ? `filter="url(#pbEmptyGray)" opacity="0.78"` : ''
  } />`;

  const thumb = `
    <svg x="${bx + 4}" y="${by + 6}" width="${thumbW}" height="${thumbH}" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet">
      ${palletBoardFixtureInnerSvg()}
    </svg>`;

  const noSize = Math.max(14, Math.round(innerH * 0.11));
  const smallSize = Math.max(9, Math.round(innerH * 0.062));
  const amber = isEmpty ? 'rgba(253, 230, 138, 0.45)' : '#fde68a';

  if (isEmpty) {
    return `
      ${baseRect}
      ${thumb}
      <text x="${bodyX}" y="${by + 12 + noSize}" font-size="${noSize}" font-weight="800" fill="${amber}" font-family="sans-serif">${escapeSvgText(String(slot.palletNo))}</text>
      <text x="${bx + innerW / 2}" y="${by + innerH * 0.58}" text-anchor="middle" font-size="${Math.round(noSize * 1.25)}" fill="rgba(255,255,255,0.22)" font-family="sans-serif">${EM_DASH}</text>
    `;
  }

  const it = slot.primaryItem!;
  const machineLine = dashOr(it.machineNameDisplay);
  const rowTop = by + 10;

  return `
    ${baseRect}
    ${thumb}
    <text x="${bodyX}" y="${rowTop + noSize}" font-size="${noSize}" font-weight="800" fill="${amber}" font-family="sans-serif">${escapeSvgText(String(slot.palletNo))}</text>
    <text x="${bx + innerW - 8}" y="${rowTop + smallSize}" text-anchor="end" font-size="${smallSize}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(qtyLabel(it.plannedQuantity))}</text>
    <text x="${bodyX}" y="${rowTop + noSize + smallSize * 1.15}" font-size="${smallSize}" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(machineLine)}</text>
    <text x="${bodyX}" y="${rowTop + noSize + smallSize * 2.35}" font-size="${smallSize}" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(`FHINBAN ${dashOr(it.fseiban)}`)}</text>
    <text x="${bodyX}" y="${rowTop + noSize + smallSize * 3.55}" font-size="${smallSize}" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(`FHINMEI ${dashOr(it.fhinmei)}`)}</text>
    <text x="${bodyX}" y="${rowTop + noSize + smallSize * 4.75}" font-size="${smallSize}" fill="${t.colors.status.info}" font-family="sans-serif">${escapeSvgText(`FHINCD ${dashOr(it.fhincd)}`)}</text>
    <text x="${bodyX}" y="${rowTop + noSize + smallSize * 5.9}" font-size="${smallSize * 0.95}" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(`着手 ${dashOr(it.plannedStartDateDisplay)}`)}</text>
  `;
}
