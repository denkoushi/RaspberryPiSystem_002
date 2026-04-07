/**
 * Playwright 用 HTML グリッドカードの数値トークン（1920 基準の layout.scale のみ依存）。
 * マジックナンバーを一箇所に閉じ、レンダラ（loan-grid-document）は組み立てに専念する。
 */

import {
  COMPACT24_HTML_CARD_PAD_PX,
  COMPACT24_HTML_NAME_MARGIN_BOTTOM_PX,
} from '../../loan-card/loan-card-contracts.js';

/** spacing: compact / default で共通（SVG レガシの thumb/pad/gap 比率と整合） */
export type GridCardSpacingTokens = {
  padPx: number;
  thumbPx: number;
  thumbCornerPx: number;
  /** サムネ画像の枠線（compact / default HTML 共通） */
  thumbBorderPx: number;
  innerGapPx: number;
  cardRadiusPx: number;
  /** カード内テキストブロック縦の詰め */
  stackGapPx: number;
  footerPadTopPx: number;
  footerRowGapPx: number;
};

export function computeGridCardSpacingTokens(scale: number): GridCardSpacingTokens {
  return {
    padPx: Math.round(12 * scale),
    thumbPx: Math.round(96 * scale),
    thumbCornerPx: Math.round(10 * scale),
    thumbBorderPx: Math.max(1, Math.round(1 * scale)),
    innerGapPx: Math.round(12 * scale),
    /** デザインギャラリー compact24 に合わせた角丸（HTML カードのみで使用） */
    cardRadiusPx: Math.round(16 * scale),
    stackGapPx: Math.round(4 * scale),
    footerPadTopPx: Math.round(4 * scale),
    footerRowGapPx: Math.round(8 * scale),
  };
}

/** compact24 専用フォント（氏名とアイテム名は意図的に同ピクセル） */
export type CompactCardFontTokens = {
  nameAndPrimaryPx: number;
  locationPx: number;
  borrowedPx: number;
  warnPx: number;
  riggingPx: number;
  mgmtPx: number;
  nameMarginBottomPx: number;
};

/** compact カードのピル・バッジ（サムネ枠は GridCardSpacingTokens.thumbBorderPx） */
export type CompactCardDecorTokens = {
  datePillPadXPx: number;
  datePillPadYPx: number;
  datePillRadiusPx: number;
  idNumBadgePadXPx: number;
  idNumBadgePadYPx: number;
  idNumBadgeRadiusPx: number;
  empTextShadow: string;
};

export function computeCompactCardFontTokens(scale: number): CompactCardFontTokens {
  return {
    nameAndPrimaryPx: Math.max(12, Math.round(14 * scale)),
    locationPx: Math.max(11, Math.round(12 * scale)),
    borrowedPx: Math.max(11, Math.round(13 * scale)),
    warnPx: Math.max(10, Math.round(11 * scale)),
    riggingPx: Math.max(12, Math.round(12 * scale)),
    mgmtPx: Math.max(12, Math.round(13 * scale)),
    nameMarginBottomPx: Math.round(COMPACT24_HTML_NAME_MARGIN_BOTTOM_PX * scale),
  };
}

export function computeCompactCardDecorTokens(scale: number): CompactCardDecorTokens {
  return {
    datePillPadXPx: Math.max(6, Math.round(8 * scale)),
    datePillPadYPx: Math.max(2, Math.round(2 * scale)),
    datePillRadiusPx: Math.max(5, Math.round(6 * scale)),
    idNumBadgePadXPx: Math.max(4, Math.round(6 * scale)),
    idNumBadgePadYPx: Math.max(1, Math.round(1 * scale)),
    idNumBadgeRadiusPx: Math.max(3, Math.round(4 * scale)),
    empTextShadow: `0 ${Math.max(1, Math.round(scale))}px ${Math.max(2, Math.round(2 * scale))}px rgba(0,0,0,0.2)`,
  };
}

export type CompactCardHtmlTokens = GridCardSpacingTokens & CompactCardFontTokens & CompactCardDecorTokens;

export function computeCompactCardHtmlTokens(scale: number): CompactCardHtmlTokens {
  return {
    ...computeGridCardSpacingTokens(scale),
    ...computeCompactCardFontTokens(scale),
    ...computeCompactCardDecorTokens(scale),
    padPx: Math.round(COMPACT24_HTML_CARD_PAD_PX * scale),
  };
}

/** 既定（非 compact）カード用フォント */
export type DefaultCardFontTokens = {
  primaryPx: number;
  secondaryPx: number;
  locationPx: number;
  borrowPx: number;
  exceededPx: number;
  riggingPx: number;
  mgmtPx: number;
};

export function computeDefaultCardFontTokens(scale: number): DefaultCardFontTokens {
  return {
    primaryPx: Math.max(16, Math.round(18 * scale)),
    secondaryPx: Math.max(14, Math.round(16 * scale)),
    locationPx: Math.max(12, Math.round(13 * scale)),
    borrowPx: Math.max(14, Math.round(14 * scale)),
    exceededPx: Math.max(14, Math.round(14 * scale)),
    riggingPx: Math.max(12, Math.round(12 * scale)),
    mgmtPx: Math.max(14, Math.round(14 * scale)),
  };
}

export type DefaultCardHtmlTokens = GridCardSpacingTokens & DefaultCardFontTokens;

export function computeDefaultCardHtmlTokens(scale: number): DefaultCardHtmlTokens {
  return {
    ...computeGridCardSpacingTokens(scale),
    ...computeDefaultCardFontTokens(scale),
  };
}
