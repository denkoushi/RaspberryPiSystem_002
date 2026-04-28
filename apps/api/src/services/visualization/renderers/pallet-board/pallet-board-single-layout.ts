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

/** ヒント行（機種名）の省略（幅に収める）。`ellipsizeToMaxChars` が単独で `…` を付与する。 */
function ellipsizeDenseHintLine(raw: string, maxChars: number): string {
  const trimmed = raw.trim();
  const lim = Math.max(4, maxChars);
  if (trimmed.length <= lim) return trimmed;
  return ellipsizeToMaxChars(trimmed, lim);
}

/**
 * パレット番号直下の「機種名」行。
 * - FHINCD が SH/MH で始まる（大文字同一視）は FHINMEI を使う。
 * - それ以外は machineNameDisplay（あれば）、なければ FHINMEI。
 */
function resolveDenseHintMachineTypeLine(it: PalletBoardSlotPrimaryItem): string {
  const cd = it.fhincd?.trim().toUpperCase() ?? '';
  if (cd.startsWith('SH') || cd.startsWith('MH')) {
    return dashOr(it.fhinmei);
  }
  const mn = it.machineNameDisplay?.trim();
  if (mn && mn.length > 0) return mn;
  return dashOr(it.fhinmei);
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

/** メタ行で着手日用（左アンカー） */
function badgeRectSvgAnchoredLeft(params: {
  leftX: number;
  ryTop: number;
  text: string;
  fontSize: number;
}): string {
  const bw = badgeWidthPx(params.text.length, params.fontSize);
  const bh = Math.round(params.fontSize * 1.55);
  const rx = params.leftX;
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

function textAdvanceApprox(fontSize: number, charCount: number): number {
  return Math.round(fontSize * 0.72 * Math.max(0, charCount));
}

const DUAL_STRIP_GAP_PX = 6;
const DUAL_STRIP_SEP_STROKE = 'rgba(140,206,206,0.55)';
/** 2段仕切り破線の太さ（1px は JPEG だと潰れやすい） */
const DUAL_STRIP_SEP_STROKE_WIDTH = 2.5;

function estimateMaxWideChars(fontPx: number, widthPx: number): number {
  return Math.max(4, Math.floor(widthPx / (fontPx * 0.72)));
}

/**
 * FHINCD・品名（密着ブロック中央行）の px。静的プレビュー
 * `docs/design-previews/pallet-board-teal-dual-vertical-preview.html` の `.line-cd`/`.line-name`（14px）と合わせる。
 */
const DENSE_FHINC_FHINMEI_FONT_PX = 14;

function renderDenseItemBlock(params: {
  bx: number;
  hintBaselineY: number;
  innerW: number;
  /** 単品でも2件でも、この高さで `slotTypo` する（2件並びでもフォントは単品と同じ）。 */
  slotInnerHeightForTypo: number;
  it: PalletBoardSlotPrimaryItem;
  t: Md3Tokens;
}): string {
  const { bx, hintBaselineY, innerW, slotInnerHeightForTypo, it, t } = params;
  const pad = 10;
  const ty = slotTypo(slotInnerHeightForTypo);
  const maxHint = Math.max(5, estimateMaxWideChars(ty.hintSize, innerW - pad * 2));
  const hint = ellipsizeDenseHintLine(resolveDenseHintMachineTypeLine(it), maxHint);

  const cdSize = DENSE_FHINC_FHINMEI_FONT_PX;
  const nameSize = DENSE_FHINC_FHINMEI_FONT_PX;
  const leftColWPx = Math.round((innerW - pad * 2) * 0.36);
  const rightColWPx = innerW - pad * 2 - leftColWPx - 6;
  const cdText = ellipsizeToMaxChars(dashOr(it.fhincd), estimateMaxWideChars(cdSize, leftColWPx));
  const meiText = ellipsizeToMaxChars(dashOr(it.fhinmei), estimateMaxWideChars(nameSize, rightColWPx));

  let y = hintBaselineY;
  let block = `
    <text x="${bx + pad}" y="${y}" font-size="${ty.hintSize}" font-weight="700" fill="${t.colors.text.secondary}"
      font-family="sans-serif">${escapeSvgText(hint)}</text>
  `;

  y += ty.hintSize * ty.lead + cdSize * 0.95;
  block += `
    <text x="${bx + pad}" y="${y}" font-size="${cdSize}" font-weight="600"
      fill="${t.colors.text.primary}" font-family="sans-serif">${escapeSvgText(cdText)}</text>
    <text x="${bx + innerW - pad}" y="${y}" font-size="${nameSize}" fill="${t.colors.text.primary}"
      text-anchor="end" font-family="sans-serif">${escapeSvgText(meiText)}</text>
  `;

  const metaFont = Math.max(ty.metaSize, Math.round(ty.hintSize * 0.9));
  const badgeFs = Math.max(8, Math.round(metaFont * 0.78));
  const dateStr = `${it.plannedStartDateDisplay ?? ''}`.trim();
  const hasDate = dateStr.length > 0;
  const sepStr = ' | ';
  const qtyStr = qtyLabel(it.plannedQuantity);
  const sepW = hasDate ? textAdvanceApprox(metaFont, sepStr.length) : 0;
  const qtyW = textAdvanceApprox(metaFont, qtyStr.length);
  const gapBeforeQty = 8;
  const rightEdge = bx + innerW - pad;
  const qtyTextX = rightEdge;
  const clusterRight = qtyTextX - qtyW - gapBeforeQty;
  const badgeW = hasDate ? badgeWidthPx(dateStr.length, badgeFs) + 4 : 0;
  const leadBudget = clusterRight - bx - pad - (hasDate ? sepW + badgeW : 0);
  const seibanDraw = ellipsizeToMaxChars(
    dashOr(it.fseiban),
    Math.max(4, estimateMaxWideChars(metaFont, Math.max(leadBudget, metaFont * 2))),
  );

  y += Math.max(cdSize, nameSize) * ty.lead + metaFont * 1.1;
  const metaBadgeTop = Math.round(y - badgeFs * 1.12);
  let leadX = bx + pad;
  block += `
    <text x="${leadX}" y="${y}" font-size="${metaFont}" font-weight="700" fill="${palletBoardSignageColor.metaPlainTeal}"
      font-family="sans-serif">${escapeSvgText(seibanDraw)}</text>
  `;
  leadX += textAdvanceApprox(metaFont, seibanDraw.length);

  if (hasDate) {
    block += `
      <text x="${leadX}" y="${y}" font-size="${metaFont}" fill="${palletBoardSignageColor.metaSeparatorMuted}"
        font-family="sans-serif">${escapeSvgText(sepStr)}</text>
    `;
    leadX += sepW;
    block += badgeRectSvgAnchoredLeft({
      leftX: leadX,
      ryTop: metaBadgeTop,
      text: dateStr,
      fontSize: badgeFs,
    });
  }

  block += `
    <text x="${qtyTextX}" y="${y}" font-size="${metaFont}" font-weight="700"
      fill="${palletBoardSignageColor.metaPlainTeal}" font-family="sans-serif" text-anchor="end">${escapeSvgText(
        qtyStr,
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
  const tPalletNo = ellipsizeToMaxChars(String(slot.palletNo), estimateMaxWideChars(tyInner.noSize, innerW / 4));
  const yHintStart = headerLineY + pad * 2.8;

  const bodyAfterHeader = `
    <text x="${bx + pad}" y="${headerLineY}"
      font-size="${tyInner.noSize}" font-weight="800" fill="${palletBoardSignageColor.palletNumberBright}"
      font-family="sans-serif">${escapeSvgText(tPalletNo)}</text>
    ${renderDenseItemBlock({
      bx,
      hintBaselineY: yHintStart,
      innerW,
      slotInnerHeightForTypo: innerH,
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
  const tPalletNo = ellipsizeToMaxChars(String(slot.palletNo), estimateMaxWideChars(ty.noSize, innerW / 4));
  const stripTop = headerLineY + pad * 2.8;
  const bottomLimit = by + innerH - pad;
  const avail = bottomLimit - stripTop;
  const segBodyH = (avail - DUAL_STRIP_GAP_PX) / 2;
  const splitY = stripTop + segBodyH + DUAL_STRIP_GAP_PX / 2;
  const insetHint = Math.round(ty.hintSize * 1.12);
  const hintBaseline1 = stripTop + insetHint;
  const hintBaseline2 = stripTop + segBodyH + DUAL_STRIP_GAP_PX + insetHint;

  const bodyDual = `
    <text x="${bx + pad}" y="${headerLineY}"
      font-size="${ty.noSize}" font-weight="800" fill="${palletBoardSignageColor.palletNumberBright}"
      font-family="sans-serif">${escapeSvgText(tPalletNo)}</text>

    <line x1="${bx + pad}" y1="${splitY}" x2="${bx + innerW - pad}" y2="${splitY}"
      stroke="${DUAL_STRIP_SEP_STROKE}" stroke-width="${DUAL_STRIP_SEP_STROKE_WIDTH}" stroke-dasharray="5 4" stroke-linecap="round" />

    ${renderDenseItemBlock({
      bx,
      hintBaselineY: hintBaseline1,
      innerW,
      slotInnerHeightForTypo: innerH,
      it: a,
      t,
    })}
    ${renderDenseItemBlock({
      bx,
      hintBaselineY: hintBaseline2,
      innerW,
      slotInnerHeightForTypo: innerH,
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
