import type { Md3Tokens } from '../_design-system/md3.js';
import type { PalletBoardSlotPrimaryItem, PalletBoardVisualizationData } from '../../visualization.types.js';
import { escapeSvgText } from '../_design-system/index.js';
import { PALLET_SIGNAGE_GRID_COLS, palletBoardSignageColor } from './pallet-board-appearance.js';
import { ellipsizeToMaxChars } from './pallet-board-svg-text.js';

const EM_DASH = '—';

function qtyLabel(q: number | null | undefined): string {
  if (q == null || !Number.isFinite(q)) return EM_DASH;
  return `${Math.round(q)}個`;
}

function dashOr(value: string | null | undefined): string {
  const s = value?.trim();
  return s && s.length > 0 ? s : EM_DASH;
}

function isSlotEmpty(slot: PalletBoardVisualizationData['machines'][number]['pallets'][number]): boolean {
  if (slot.isEmpty === true) return true;
  if (slot.primaryItem) return false;
  return slot.lines.length === 0;
}

function estimateHintFromFseiban(fseiban: string, maxChars: number): string {
  const trimmed = fseiban.trim();
  if (trimmed.length <= maxChars + 3) return trimmed;
  return `${ellipsizeToMaxChars(trimmed, maxChars - 3)}…`;
}

/** サイネ用タイポ（スロット高さ依存） */
function slotTypo(innerH: number): {
  noSize: number;
  badgeSize: number;
  bodySize: number;
  hintSize: number;
  metaSize: number;
  lead: number;
} {
  const noSize = Math.max(14, Math.round(innerH * 0.095));
  const badgeSize = Math.max(8, Math.round(innerH * 0.058));
  const bodySize = Math.max(9, Math.round(innerH * 0.062));
  const hintSize = Math.max(8, Math.round(innerH * 0.054));
  const metaSize = Math.max(7.5, Math.round(innerH * 0.05));
  const lead = 1.28;
  return { noSize, badgeSize, bodySize, hintSize, metaSize, lead };
}

function badgeWidthPx(textLen: number, fontSize: number): number {
  return Math.max(Math.round(fontSize * 2.9), Math.round(fontSize * 0.72 * Math.max(textLen, 3)));
}

function badgeRectSvgAnchoredRight(params: {
  rightX: number;
  ryTop: number;
  text: string;
  fontSize: number;
}): string {
  const bw = badgeWidthPx(params.text.length, params.fontSize);
  const bh = Math.round(params.fontSize * 1.55);
  const rx = params.rightX - bw;
  return `
    <rect x="${rx}" y="${params.ryTop}" width="${bw}" height="${bh}" rx="${Math.round(params.fontSize * 0.75)}"
      fill="${palletBoardSignageColor.badgeFill}"
      stroke="${palletBoardSignageColor.badgeStroke}" stroke-width="1" />
    <text x="${rx + bw / 2}" y="${params.ryTop + bh - Math.round(params.fontSize * 0.35)}"
      font-size="${params.fontSize}" font-weight="700"
      fill="${palletBoardSignageColor.badgeText}" font-family="sans-serif"
      text-anchor="middle">${escapeSvgText(params.text)}</text>
  `;
}

function estimateMaxWideChars(fontPx: number, widthPx: number): number {
  return Math.max(4, Math.floor(widthPx / (fontPx * 0.72)));
}

function renderDenseLinesColumn(params: {
  bx: number;
  yStartHint: number;
  innerW: number;
  slotInnerHeight: number;
  it: PalletBoardSlotPrimaryItem;
  t: Md3Tokens;
}): string {
  const { bx, yStartHint, innerW, slotInnerHeight, it, t } = params;
  const ty = slotTypo(slotInnerHeight);
  const pad = 10;
  const maxHint = Math.max(5, estimateMaxWideChars(ty.hintSize, innerW - pad * 2));
  const hint = estimateHintFromFseiban(dashOr(it.fseiban), maxHint);

  let y = yStartHint;
  let block = `
    <text x="${bx + pad}" y="${y}" font-size="${ty.hintSize}" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(hint)}</text>
  `;
  y += ty.hintSize * ty.lead + ty.bodySize * 1.05;

  block += `
    <text x="${bx + pad}" y="${y}" font-size="${Math.round(ty.bodySize * 1.05)}" font-weight="600"
      fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(dashOr(it.fhincd))}</text>
  `;
  y += ty.bodySize * ty.lead + 2;

  block += `
    <text x="${bx + pad}" y="${y}" font-size="${ty.bodySize}" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(dashOr(it.fhinmei))}</text>
  `;
  y += ty.bodySize * ty.lead + 2;

  const metaTxt = `${dashOr(it.fseiban)}${it.plannedStartDateDisplay != null && `${it.plannedStartDateDisplay}`.trim() ? ` | ${dashOr(it.plannedStartDateDisplay)}` : ''}`;
  block += `
    <text x="${bx + pad}" y="${y}" font-size="${ty.metaSize}" fill="${t.colors.status.info}"
      font-family="sans-serif">${escapeSvgText(
        ellipsizeToMaxChars(metaTxt, estimateMaxWideChars(ty.metaSize, innerW - pad * 2)),
      )}</text>
  `;

  return block;
}

type SlotPieces = { clipDef: string; body: string };

function renderOccupiedDenseSingle(slot: PalletBoardVisualizationData['machines'][number]['pallets'][number], idx: number, bx: number, by: number, innerW: number, innerH: number, t: Md3Tokens): SlotPieces {
  const it = slot.primaryItem!;
  const tyInner = slotTypo(innerH);
  const clipId = `pbSlot_${idx}`;
  const pad = 10;
  const headerLineY = by + pad + tyInner.noSize;
  const qty = qtyLabel(it.plannedQuantity);
  const tPalletNo = ellipsizeToMaxChars(String(slot.palletNo), estimateMaxWideChars(tyInner.noSize, innerW / 4));
  const yHintStart = by + tyInner.noSize + Math.round(tyInner.badgeSize * 2.2);

  const bodyAfterHeader = `
    ${badgeRectSvgAnchoredRight({
      rightX: bx + innerW - pad,
      ryTop: by + pad + 2,
      text: qty,
      fontSize: tyInner.badgeSize,
    })}
    <text x="${bx + pad}" y="${headerLineY}"
      font-size="${tyInner.noSize}" font-weight="800" fill="${palletBoardSignageColor.palletNumberBright}"
      font-family="sans-serif">${escapeSvgText(tPalletNo)}</text>
    ${renderDenseLinesColumn({
      bx,
      yStartHint: yHintStart,
      innerW,
      slotInnerHeight: innerH,
      it,
      t,
    })}
  `;

  return {
    clipDef: `<clipPath id="${clipId}"><rect x="${bx}" y="${by}" width="${innerW}" height="${innerH}" rx="10" /></clipPath>`,
    body: `
      <g clip-path="url(#${clipId})">
        ${bodyAfterHeader}
      </g>`,
  };
}

function renderOccupiedDual(slot: PalletBoardVisualizationData['machines'][number]['pallets'][number], idx: number, bx: number, by: number, innerW: number, innerH: number, t: Md3Tokens): SlotPieces {
  const a = slot.primaryItem!;
  const b = slot.secondaryItem!;
  const ty = slotTypo(innerH);
  const clipId = `pbSlot_dual_${idx}`;
  const pad = 10;
  const headerLineY = by + pad + ty.noSize;
  const SPLIT = 8;
  const splitMid = SPLIT / 2;
  const halfW = (innerW - SPLIT) / 2;
  const tPalletNo = ellipsizeToMaxChars(String(slot.palletNo), estimateMaxWideChars(ty.noSize, innerW / 4));
  const midX = bx + halfW + splitMid;
  const lineTop = headerLineY + pad * 0.85;
  const badgeRowY = by + ty.noSize + pad * 0.9;
  const yHintBelowBadges = by + ty.noSize + ty.badgeSize + pad * 3.2;

  const leftBadgeRight = bx + halfW + splitMid - pad;
  const rightBadgeRight = bx + innerW - pad;

  const bodyDual = `
    <text x="${bx + pad}" y="${headerLineY}"
      font-size="${ty.noSize}" font-weight="800" fill="${palletBoardSignageColor.palletNumberBright}"
      font-family="sans-serif">${escapeSvgText(tPalletNo)}</text>
    <line x1="${midX}" y1="${lineTop}" x2="${midX}" y2="${by + innerH - pad}"
      stroke="rgba(126,200,200,0.42)" stroke-width="1" stroke-dasharray="4 3" />

    ${badgeRectSvgAnchoredRight({
      rightX: leftBadgeRight,
      ryTop: badgeRowY,
      text: qtyLabel(a.plannedQuantity),
      fontSize: ty.badgeSize,
    })}
    ${badgeRectSvgAnchoredRight({
      rightX: rightBadgeRight,
      ryTop: badgeRowY,
      text: qtyLabel(b.plannedQuantity),
      fontSize: ty.badgeSize,
    })}

    ${renderDenseLinesColumn({
      bx: bx + pad,
      yStartHint: yHintBelowBadges,
      innerW: halfW + splitMid - pad * 2,
      slotInnerHeight: innerH,
      it: a,
      t,
    })}
    ${renderDenseLinesColumn({
      bx: bx + halfW + SPLIT + pad,
      yStartHint: yHintBelowBadges,
      innerW: halfW + splitMid - pad * 2,
      slotInnerHeight: innerH,
      it: b,
      t,
    })}
  `;

  return {
    clipDef: `<clipPath id="${clipId}"><rect x="${bx}" y="${by}" width="${innerW}" height="${innerH}" rx="10" /></clipPath>`,
    body: `<g clip-path="url(#${clipId})">${bodyDual}</g>`,
  };
}

function renderEmptyDense(slotNo: number, idx: number, bx: number, by: number, innerW: number, innerH: number, ty: ReturnType<typeof slotTypo>, maxPallet: number): SlotPieces {
  const clipId = `pbEmp_${idx}`;
  const pad = 12;
  const headerY = by + pad + ty.noSize;
  const palletLabel = ellipsizeToMaxChars(String(slotNo), maxPallet);
  return {
    clipDef: `<clipPath id="${clipId}"><rect x="${bx}" y="${by}" width="${innerW}" height="${innerH}" rx="10" /></clipPath>`,
    body: `
      <g clip-path="url(#${clipId})">
        <text x="${bx + pad}" y="${headerY}" font-size="${ty.noSize}" font-weight="800"
          fill="${palletBoardSignageColor.palletNumberMuted}"
          font-family="sans-serif">${escapeSvgText(palletLabel)}</text>
        <text x="${bx + innerW / 2}" y="${by + innerH * 0.58}" font-size="${Math.round(ty.noSize * 1.2)}" fill="rgba(255,255,255,0.22)"
          text-anchor="middle" font-family="sans-serif">${EM_DASH}</text>
      </g>`,
  };
}

function buildBaseSlotFaceRect(bx: number, by: number, innerW: number, innerH: number, empty: boolean): string {
  if (empty) {
    return `
      <rect x="${bx}" y="${by}" width="${innerW}" height="${innerH}" rx="10"
        fill="${palletBoardSignageColor.cardEmptyFill}"
        stroke="${palletBoardSignageColor.emptyDashBorder}" stroke-width="1.2"
        stroke-dasharray="5 6"
        opacity="0.92" />`;
  }
  return `
      <rect x="${bx}" y="${by}" width="${innerW}" height="${innerH}" rx="10"
        fill="${palletBoardSignageColor.cardOccupiedFill}"
        stroke="${palletBoardSignageColor.activeStroke}" stroke-width="2"
        style="filter: drop-shadow(0 0 2px ${palletBoardSignageColor.activeGlow})"
      />`;
}

/** 単一加工機レイアウト SVG（サイネJPEG用ティール調） */
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
  const { width, height, t, machine, leftPanelImageDataUri } = params;

  void params.title;
  void params.subtitle;
  void params.cardThumbDataUri;

  const margin = Math.round(Math.min(width, height) * 0.014);
  const contentTop = margin;
  const contentH = height - margin * 2;
  const contentW = width - margin * 2;
  const splitGap = Math.round(Math.min(width, height) * 0.012);
  const leftWRatio = 0.26;
  const leftW = Math.round(contentW * leftWRatio) - splitGap / 2;
  const rightW = contentW - leftW - splitGap;
  const leftX = margin;
  const rightX = margin + leftW + splitGap;

  const palletCols = PALLET_SIGNAGE_GRID_COLS;
  const pallets = machine.pallets;
  const palletRowsComputed = Math.max(1, Math.ceil(pallets.length / palletCols));
  const slotW = rightW / palletCols;
  const slotH = contentH / palletRowsComputed;

  const nameSize = Math.max(15, Math.round(leftW / 16));
  const unitSize = Math.max(11, Math.round(leftW / 26));
  const machineTitleY = contentTop + 32;
  const machineSubY = machineTitleY + nameSize + 6;
  const imgBoxY = machineSubY + 14;
  const imgBoxX = leftX + 12;
  const imgBoxW = leftW - 24;
  const imgBoxH = contentTop + contentH - imgBoxY - 12;
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

  const clipDefsAccumulator: string[] = [];
  const slotBodiesAccumulator: string[] = [];

  pallets.forEach((slot, idx) => {
    const pc = idx % palletCols;
    const pr = Math.floor(idx / palletCols);
    const sx = rightX + pc * slotW;
    const sy = contentTop + pr * slotH;
    const padOuter = Math.max(5, Math.round(Math.min(slotW, slotH) * 0.028));
    const bx = sx + padOuter;
    const by = sy + padOuter;
    const innerW = slotW - padOuter * 2;
    const innerH = slotH - padOuter * 2;
    const ty = slotTypo(innerH);

    const emptyNow = isSlotEmpty(slot);

    const baseFace = buildBaseSlotFaceRect(bx, by, innerW, innerH, emptyNow);

    if (emptyNow) {
      const maxPalletCh = estimateMaxWideChars(ty.noSize, innerW / 6);
      const empt = renderEmptyDense(slot.palletNo, idx, bx, by, innerW, innerH, ty, maxPalletCh);
      clipDefsAccumulator.push(empt.clipDef);
      slotBodiesAccumulator.push(`${baseFace}${empt.body}`);
      return;
    }

    if (slot.secondaryItem != null && slot.primaryItem != null) {
      const dual = renderOccupiedDual(slot, idx, bx, by, innerW, innerH, t);
      clipDefsAccumulator.push(dual.clipDef);
      slotBodiesAccumulator.push(`${baseFace}${dual.body}`);
      return;
    }

    if (slot.primaryItem != null) {
      const one = renderOccupiedDenseSingle(slot, idx, bx, by, innerW, innerH, t);
      clipDefsAccumulator.push(one.clipDef);
      slotBodiesAccumulator.push(`${baseFace}${one.body}`);
    }

  });

  return `
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
    <defs>
      <filter id="pbEmptyGray" x="-10%" y="-10%" width="120%" height="120%">
        <feColorMatrix type="saturate" values="0.35" />
      </filter>
      ${leftPanelClipDef}
      ${clipDefsAccumulator.join('\n')}
    </defs>
    <rect width="100%" height="100%" fill="${t.colors.surface.background}" />

    <rect x="${leftX}" y="${contentTop}" width="${leftW}" height="${contentH}" rx="12"
      fill="${t.colors.surface.container}" stroke="${palletBoardSignageColor.sidebarOutline}" stroke-width="1" />

    <text x="${leftX + 14}" y="${machineTitleY}" font-size="${nameSize}" font-weight="700" fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(machine.machineName)}</text>
    <text x="${leftX + 14}" y="${machineSubY}" font-size="${unitSize}" fill="${t.colors.text.secondary}" font-family="sans-serif">${escapeSvgText(`(${machine.machineCd})`)}</text>

    <rect x="${imgBoxX}" y="${imgBoxY}" width="${imgBoxW}" height="${imgBoxH}" rx="10"
      fill="#ffffff"
      stroke="rgba(255,255,255,0.1)" stroke-width="1" />
    ${leftPanelImageBlock}

    ${slotBodiesAccumulator.join('\n')}
  </svg>`;
}
