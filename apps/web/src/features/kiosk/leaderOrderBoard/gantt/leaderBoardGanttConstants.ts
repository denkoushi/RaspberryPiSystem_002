/** ガント表示専用寸法（順位ボード UI のみ）。 */

export const GANTT_MIN_ROW_HEIGHT_PX = 96;
export const GANTT_ROW_VERTICAL_PADDING_PX = 4;
export const GANTT_FOOTER_CHIPS_EXTRA_PX = 28;
export const GANTT_MAX_ROW_HEIGHT_PX = 384;
export const GANTT_EIGHT_HOURS_MINUTES = 480;
export const GANTT_PX_PER_MINUTE = GANTT_MIN_ROW_HEIGHT_PX / GANTT_EIGHT_HOURS_MINUTES;

/** 左端 8H 目盛ガター幅 */
export const GANTT_TICK_GUTTER_WIDTH_PX = 8;

/** 8H 境界の縦線高さ（px） */
export const GANTT_TICK_LINE_HEIGHT_PX = 1;

/** ガント ON 時の仮想リスト overscan（OFF 時は leaderBoardRefetchPolicy の 3） */
export const GANTT_VIRTUAL_OVERSCAN = 2;

/** ガント ON 時のカード高さ上限（viewport 基準・内側スクロール発火用） */
export const GANTT_CARD_MAX_HEIGHT_VH = 70;
