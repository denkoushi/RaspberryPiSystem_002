/**
 * 計測機器持出カードのレイアウト設計値（1920×1080 基準の設計 px）。
 * card-layout・本文レイアウト・SVG レンダラー・design-preview の単一参照点。
 */

/** 氏名・件数行のベースライン（カード上端からの Y オフセット、設計 px） */
export const MI_NAME_HEADER_BASELINE_YPX = 34;

/**
 * ヘッダ帯の下端（カード上端からの Y）。帯の塗りは 0 … この値まで。
 */
export const MI_HEADER_BAND_END_YPX = 50;

/** 帯下端から本文エリア先頭（1 行目ベースライン手前の区間）に確保するギャップ。HTML の `--mi-header-body-gap` に相当 */
export const MI_HEADER_TO_BODY_GAP_YPX = 10;

/** 帯下端〜明細1行目ベースラインまでの導入（行ボックス上端→ベースライン想定、設計 px） */
export const MI_BODY_FIRST_LINE_LEADIN_YPX = 16;

/**
 * 本文 1 行目の text の y（ベースライン）のカード上端からのオフセット（設計 px）。
 * 旧 66 相当から帯＋帯下ギャップを明示。layout-mi-instrument-body の namesStartY と必ず一致させる。
 */
export const MI_NAMES_START_YPX =
  MI_HEADER_BAND_END_YPX + MI_HEADER_TO_BODY_GAP_YPX + MI_BODY_FIRST_LINE_LEADIN_YPX;

export const MI_CARD_INNER_PAD_PX = 12;
export const MI_CARD_BOTTOM_PAD_PX = 12;
export const MI_CARD_CORNER_RADIUS_PX = 10;

/**
 * 貸出ありカード帯（T4）: `color-mix(in srgb, status-warning この比, status-info-container)` 相当。
 * `mi-instrument-card-palette`・`design-preview` HTML の帯 must match。
 */
export const MI_LOAN_ACTIVE_BAND_WARNING_MIX = 0.22;

export function scaleDesignPx(designYpx: number, scale: number): number {
  return Math.round(designYpx * scale);
}

export function getHeaderBodyGapCssPixels(): number {
  return MI_HEADER_TO_BODY_GAP_YPX;
}
