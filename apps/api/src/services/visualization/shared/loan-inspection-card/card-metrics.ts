/**
 * 持出・点検可視化カードのレイアウト設計値（1920×1080 基準の設計 px）。
 */

/** 氏名・件数行のベースライン（カード上端からの Y オフセット、設計 px） */
export const LOAN_INSPECTION_NAME_HEADER_BASELINE_YPX = 34;

/** ヘッダ帯の下端（カード上端からの Y）。帯の塗りは 0 … この値まで。 */
export const LOAN_INSPECTION_HEADER_BAND_END_YPX = 50;

/** 帯下端から本文エリア先頭に確保するギャップ */
export const LOAN_INSPECTION_HEADER_TO_BODY_GAP_YPX = 10;

/** 帯下端〜明細1行目ベースラインまでの導入 */
export const LOAN_INSPECTION_BODY_FIRST_LINE_LEADIN_YPX = 16;

export const LOAN_INSPECTION_NAMES_START_YPX =
  LOAN_INSPECTION_HEADER_BAND_END_YPX +
  LOAN_INSPECTION_HEADER_TO_BODY_GAP_YPX +
  LOAN_INSPECTION_BODY_FIRST_LINE_LEADIN_YPX;

export const LOAN_INSPECTION_CARD_INNER_PAD_PX = 12;
export const LOAN_INSPECTION_CARD_BOTTOM_PAD_PX = 12;
export const LOAN_INSPECTION_CARD_CORNER_RADIUS_PX = 10;

/** 貸出ありカード帯: warning 22% + infoContainer 相当 */
export const LOAN_INSPECTION_ACTIVE_BAND_WARNING_MIX = 0.22;

export function scaleDesignPx(designYpx: number, scale: number): number {
  return Math.round(designYpx * scale);
}

export function getHeaderBodyGapCssPixels(): number {
  return LOAN_INSPECTION_HEADER_TO_BODY_GAP_YPX;
}
