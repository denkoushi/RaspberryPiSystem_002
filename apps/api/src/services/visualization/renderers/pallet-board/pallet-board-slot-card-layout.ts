import { estimateMaxCharsForLine } from './pallet-board-svg-text.js';

/** スロット内でヘッダー上端から内側へ */
const PAD_TOP = 8;
/** ヘッダ行（番号+個数）下〜上段コンテンツ始まり */
const GAP_HEADER_TO_UPPER = 8;
/** 上段（サムネ+機種）と下段（全幅4行）の隙間 */
const GAP_UPPER_TO_FULL = 6;
const THUMB_W_RATIO = 0.3;
const THUMB_TO_MACHINE_GAP = 10;
const INSET_H = 8;
const LINE_LEADING = 1.2;
const MIN_THUMB_H = 28;
/** サムネ高さ: 概ね正方形に近いマスタ想定の上限（innerH に対し食い切らない） */
const THUMB_H_INNERH_CAP = 0.36;
/** サムネ幅比からの仮高さ */
const THUMB_H_FROM_W_RATIO = 1.12;

/**
 * 単一スロット内の幾何（本番SVGとデザインプレビューHTMLの上段+下段全幅）を純粋に計算する。
 * 座標系: bx, by はスロット内角丸矩形の左上。
 */
export type PalletSlotCardLayout = {
  headerBaselineY: number;
  rowContentTopY: number;
  /** renderSlotThumb(bx, rowContentTopY, thumbW, thumbH) に渡す w/h；画像は y+2 に配置される既存措置 */
  thumbW: number;
  thumbH: number;
  /** 機種1行（上段右列） */
  bodyX: number;
  machineBaselineY: number;
  machineTextMaxWidthPx: number;
  /** 下段4行（fseiban / fhinmei / fhincd / 着手日）: 各 `<text x=fullWidthX>` */
  fullWidthX: number;
  fullWidthTextMaxWidthPx: number;
  fullWidthLineBaselines: [number, number, number, number];
};

export type PalletSlotCardLayoutModel = {
  layout: PalletSlotCardLayout;
  maxPallet: number;
  maxQty: number;
  maxMachine: number;
  maxFullWidth: number;
};

/**
 * 品目ありスロット用。空スロットは同じ bx/by/inner* /noSize/smallSize で本関数を呼び、
 * thumb 周り・ヘッダのみ使用すれば幾何は一致する。
 */
export function computePalletSlotCardLayout(params: {
  bx: number;
  by: number;
  innerW: number;
  innerH: number;
  noSize: number;
  smallSize: number;
}): PalletSlotCardLayoutModel {
  const { by, innerW, innerH, noSize, smallSize } = params;

  const headerBaselineY = by + PAD_TOP + noSize;
  const rowContentTopY = by + PAD_TOP + noSize + GAP_HEADER_TO_UPPER;
  const headerHalfW = Math.max(0, (innerW - INSET_H * 2) * 0.5);
  const maxPallet = Math.max(1, estimateMaxCharsForLine(headerHalfW - 8, noSize));
  const maxQty = Math.max(1, estimateMaxCharsForLine(headerHalfW - 8, smallSize));

  const thumbW = Math.round(innerW * THUMB_W_RATIO);
  const thumbHUncapped = Math.max(MIN_THUMB_H, Math.round(thumbW * THUMB_H_FROM_W_RATIO));
  const thumbHCap = Math.max(MIN_THUMB_H, Math.round(innerH * THUMB_H_INNERH_CAP));
  const thumbH = Math.min(thumbHUncapped, thumbHCap);

  const { bx } = params;
  const bodyX = bx + thumbW + THUMB_TO_MACHINE_GAP;
  const machineTextMaxWidthPx = Math.max(0, bx + innerW - INSET_H - bodyX);
  const maxMachine = Math.max(1, estimateMaxCharsForLine(machineTextMaxWidthPx, smallSize));

  const fullWidthX = bx + INSET_H;
  const fullWidthTextMaxWidthPx = Math.max(0, innerW - INSET_H * 2);
  const maxFullWidth = Math.max(1, estimateMaxCharsForLine(fullWidthTextMaxWidthPx, smallSize));

  const machineBaselineY = rowContentTopY + 4 + smallSize;
  const thumbBottomY = rowContentTopY + 2 + thumbH;
  const machineApproxBottomY = rowContentTopY + 4 + smallSize * 1.25;
  const upperBottomY = Math.max(thumbBottomY, machineApproxBottomY);
  const firstFullBaselineY = upperBottomY + GAP_UPPER_TO_FULL + smallSize;
  const fullWidthLineBaselines: [number, number, number, number] = [
    firstFullBaselineY,
    firstFullBaselineY + smallSize * LINE_LEADING,
    firstFullBaselineY + smallSize * LINE_LEADING * 2,
    firstFullBaselineY + smallSize * LINE_LEADING * 3,
  ];

  return {
    layout: {
      headerBaselineY,
      rowContentTopY,
      thumbW,
      thumbH,
      bodyX,
      machineBaselineY,
      machineTextMaxWidthPx,
      fullWidthX,
      fullWidthTextMaxWidthPx,
      fullWidthLineBaselines,
    },
    maxPallet,
    maxQty,
    maxMachine,
    maxFullWidth,
  };
}
