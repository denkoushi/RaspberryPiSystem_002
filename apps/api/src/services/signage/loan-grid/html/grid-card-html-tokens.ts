/**
 * Playwright 用 HTML グリッドカードの数値トークン（1920 基準の layout.scale のみ依存）。
 * マジックナンバーを一箇所に閉じ、レンダラ（loan-grid-document）は組み立てに専念する。
 */

/** spacing: compact / default で共通（SVG レガシの thumb/pad/gap 比率と整合） */
export type GridCardSpacingTokens = {
  padPx: number;
  thumbPx: number;
  thumbCornerPx: number;
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
    thumbCornerPx: Math.round(8 * scale),
    innerGapPx: Math.round(12 * scale),
    cardRadiusPx: Math.round(12 * scale),
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

export function computeCompactCardFontTokens(scale: number): CompactCardFontTokens {
  return {
    nameAndPrimaryPx: Math.max(12, Math.round(14 * scale)),
    locationPx: Math.max(11, Math.round(12 * scale)),
    borrowedPx: Math.max(11, Math.round(13 * scale)),
    warnPx: Math.max(10, Math.round(11 * scale)),
    riggingPx: Math.max(12, Math.round(12 * scale)),
    mgmtPx: Math.max(12, Math.round(13 * scale)),
    nameMarginBottomPx: Math.round(4 * scale),
  };
}

export type CompactCardHtmlTokens = GridCardSpacingTokens & CompactCardFontTokens;

export function computeCompactCardHtmlTokens(scale: number): CompactCardHtmlTokens {
  return {
    ...computeGridCardSpacingTokens(scale),
    ...computeCompactCardFontTokens(scale),
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
