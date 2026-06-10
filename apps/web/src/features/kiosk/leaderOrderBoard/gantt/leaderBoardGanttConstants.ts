/** ガント表示専用寸法（順位ボード UI のみ）。 */

export const GANTT_MIN_ROW_HEIGHT_PX = 96;
export const GANTT_ROW_VERTICAL_PADDING_PX = 4;
export const GANTT_FOOTER_CHIPS_EXTRA_PX = 28;
export const GANTT_EIGHT_HOURS_MINUTES = 480;

/** 可変スケール未確定時のフォールバック（8H = 96px 相当） */
export const GANTT_FALLBACK_PX_PER_MINUTE = GANTT_MIN_ROW_HEIGHT_PX / GANTT_EIGHT_HOURS_MINUTES;

/** ResizeObserver 未確定時の本文高さ見積 */
export const GANTT_FALLBACK_AVAILABLE_WORK_HEIGHT_PX = 480;

/** 左端 8H 目盛ガター幅 */
export const GANTT_TICK_GUTTER_WIDTH_PX = 8;

/** 0H 上端線の高さ（px） */
export const GANTT_TICK_ORIGIN_LINE_HEIGHT_PX = 1;

/** 8H/16H 境界線の高さ（px） */
export const GANTT_TICK_BOUNDARY_LINE_HEIGHT_PX = 3;

/** ガント ON 時の仮想リスト overscan（OFF 時は leaderBoardRefetchPolicy の 3） */
export const GANTT_VIRTUAL_OVERSCAN = 2;
