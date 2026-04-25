import type { Md3Tokens } from '../_design-system/md3.js';
import type { PalletBoardVisualizationData } from '../../visualization.types.js';
import { escapeSvgText } from '../_design-system/index.js';
import { palletBoardFixtureInnerSvg } from './pallet-board-fixture-svg.js';
import { ellipsizeToMaxChars, estimateMaxCharsForLine } from './pallet-board-svg-text.js';

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
  leftPanelImageDataUri: string | null;
  cardThumbDataUri: string | null;
}): string {
  const { width, height, t, title, subtitle, machine, leftPanelImageDataUri, cardThumbDataUri } = params;
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

  const imgBoxX = leftX + 14;
  const imgBoxY = contentTop + 76;
  const imgBoxW = leftW - 28;
  const imgBoxH = contentH - 90;
  const leftPanelClipId = 'pbLeftPanelImg';

  const leftPanelClipDef = leftPanelImageDataUri
    ? `<clipPath id="${leftPanelClipId}"><rect x="${imgBoxX}" y="${imgBoxY}" width="${imgBoxW}" height="${imgBoxH}" rx="10" /></clipPath>`
    : '';

  const leftPanelImageBlock = leftPanelImageDataUri
    ? `<g clip-path="url(#${leftPanelClipId})"><image
        x="${imgBoxX}"
        y="${imgBoxY}"
        width="${imgBoxW}"
        height="${imgBoxH}"
        href="${leftPanelImageDataUri}"
        xlink:href="${leftPanelImageDataUri}"
        preserveAspectRatio="xMidYMid meet"
      /></g>`
    : `<text
        x="${leftX + leftW / 2}"
        y="${imgBoxY + imgBoxH / 2}"
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="${Math.max(16, Math.round(leftW / 12))}"
        font-weight="600"
        fill="${t.colors.text.secondary}"
        font-family="sans-serif"
      >機械イラスト</text>`;

  const slotBlocks = pallets.map((slot, idx) =>
    renderSlot({
      slot,
      idx,
      palletCols,
      contentTop,
      rightX,
      slotW,
      slotH,
      t,
      cardThumbDataUri,
    }),
  );
  const slotClipDefs = slotBlocks.map((b) => b.clipDef).join('');
  const slotBodies = slotBlocks.map((b) => b.body).join('');

  return `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs>
      <filter id="pbEmptyGray" x="-10%" y="-10%" width="120%" height="120%">
        <feColorMatrix type="saturate" values="0.35" />
      </filter>
      ${leftPanelClipDef}
      ${slotClipDefs}
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
    <rect x="${imgBoxX}" y="${imgBoxY}" width="${imgBoxW}" height="${imgBoxH}" rx="10"
      fill="rgba(0,0,0,0.25)" stroke="${t.colors.grid}" stroke-width="1" />
    ${leftPanelImageBlock}

    ${slotBodies}
  </svg>`;
}

type SlotRender = { clipDef: string; body: string };

function renderSlotThumb(bx: number, by: number, thumbW: number, thumbH: number, cardThumbDataUri: string | null): string {
  if (cardThumbDataUri) {
    return `<image
      x="${bx + 4}"
      y="${by + 6}"
      width="${thumbW}"
      height="${thumbH}"
      href="${cardThumbDataUri}"
      xlink:href="${cardThumbDataUri}"
      preserveAspectRatio="xMidYMid meet"
    />`;
  }
  return `
    <svg x="${bx + 4}" y="${by + 6}" width="${thumbW}" height="${thumbH}" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid meet">
      ${palletBoardFixtureInnerSvg()}
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
  cardThumbDataUri: string | null;
}): SlotRender {
  const { slot, idx, palletCols, contentTop, rightX, slotW, slotH, t, cardThumbDataUri } = params;
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
  const textBlockW = Math.max(0, innerW - thumbW - 10 - 8);
  const clipId = `palletSlotClip_${idx}`;

  const baseRect = `<rect x="${bx}" y="${by}" width="${innerW}" height="${innerH}" rx="10" fill="${fillColor}" stroke="${strokeColor}" stroke-width="2" ${
    isEmpty ? `filter="url(#pbEmptyGray)" opacity="0.78"` : ''
  } />`;

  const thumb = renderSlotThumb(bx, by, thumbW, thumbH, cardThumbDataUri);

  const noSize = Math.max(14, Math.round(innerH * 0.11));
  const smallSize = Math.max(9, Math.round(innerH * 0.062));
  const maxNo = Math.max(1, estimateMaxCharsForLine(textBlockW, noSize));
  const maxSmall = Math.max(1, estimateMaxCharsForLine(textBlockW, smallSize));
  const amber = isEmpty ? 'rgba(253, 230, 138, 0.45)' : '#fde68a';

  const clipDef = `<clipPath id="${clipId}"><rect x="${bx}" y="${by}" width="${innerW}" height="${innerH}" rx="10" /></clipPath>`;

  if (isEmpty) {
    const body = `
    <g clip-path="url(#${clipId})">
      ${baseRect}
      ${thumb}
      <text x="${bodyX}" y="${by + 12 + noSize}" font-size="${noSize}" font-weight="800" fill="${amber}" font-family="sans-serif">${escapeSvgText(ellipsizeToMaxChars(String(slot.palletNo), maxNo))}</text>
      <text x="${bx + innerW / 2}" y="${by + innerH * 0.58}" text-anchor="middle" font-size="${Math.round(noSize * 1.25)}" fill="rgba(255,255,255,0.22)" font-family="sans-serif">${EM_DASH}</text>
    </g>`;
    return { clipDef, body };
  }

  const it = slot.primaryItem!;
  const machineLine = dashOr(it.machineNameDisplay);
  const rowTop = by + 10;

  const tPallet = ellipsizeToMaxChars(String(slot.palletNo), maxNo);
  const tQty = ellipsizeToMaxChars(qtyLabel(it.plannedQuantity), maxSmall);
  const tMachine = ellipsizeToMaxChars(machineLine, maxSmall);
  const tFseiban = ellipsizeToMaxChars(`FHINBAN ${dashOr(it.fseiban)}`, maxSmall);
  const tFhinmei = ellipsizeToMaxChars(`FHINMEI ${dashOr(it.fhinmei)}`, maxSmall);
  const tFhincd = ellipsizeToMaxChars(`FHINCD ${dashOr(it.fhincd)}`, maxSmall);
  const tStart = ellipsizeToMaxChars(`着手 ${dashOr(it.plannedStartDateDisplay)}`, maxSmall);

  const body = `
    <g clip-path="url(#${clipId})">
      ${baseRect}
      ${thumb}
      <text x="${bodyX}" y="${rowTop + noSize}" font-size="${noSize}" font-weight="800" fill="${amber}" font-family="sans-serif">${escapeSvgText(tPallet)}</text>
      <text x="${bx + innerW - 8}" y="${rowTop + smallSize}" text-anchor="end" font-size="${smallSize}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(tQty)}</text>
      <text x="${bodyX}" y="${rowTop + noSize + smallSize * 1.15}" font-size="${smallSize}" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(tMachine)}</text>
      <text x="${bodyX}" y="${rowTop + noSize + smallSize * 2.35}" font-size="${smallSize}" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(tFseiban)}</text>
      <text x="${bodyX}" y="${rowTop + noSize + smallSize * 3.55}" font-size="${smallSize}" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(tFhinmei)}</text>
      <text x="${bodyX}" y="${rowTop + noSize + smallSize * 4.75}" font-size="${smallSize}" fill="${t.colors.status.info}" font-family="sans-serif">${escapeSvgText(tFhincd)}</text>
      <text x="${bodyX}" y="${rowTop + noSize + smallSize * 5.9}" font-size="${smallSize * 0.95}" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(tStart)}</text>
    </g>`;
  return { clipDef, body };
}
