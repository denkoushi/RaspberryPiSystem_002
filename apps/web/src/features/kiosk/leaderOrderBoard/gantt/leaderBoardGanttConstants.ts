/** ガント表示専用寸法（順位ボード UI のみ）。 */

export const GANTT_MIN_ROW_HEIGHT_PX = 96;
export const GANTT_ROW_VERTICAL_PADDING_PX = 4;
export const GANTT_FOOTER_CHIPS_EXTRA_PX = 28;
export const GANTT_EIGHT_HOURS_MINUTES = 480;
export const GANTT_TEN_HOURS_MINUTES = 600;

/** 基準時間帯の既定値（8H）。 */
export const GANTT_DEFAULT_CAPACITY_MINUTES = GANTT_EIGHT_HOURS_MINUTES;

/** 設定可能な基準時間の下限（分）。 */
export const GANTT_MIN_CAPACITY_MINUTES = 60;

/** 可変スケール未確定時のフォールバック（8H = 96px 相当） */
export const GANTT_FALLBACK_PX_PER_MINUTE = GANTT_MIN_ROW_HEIGHT_PX / GANTT_EIGHT_HOURS_MINUTES;

/** ResizeObserver 未確定時の本文高さ見積 */
export const GANTT_FALLBACK_AVAILABLE_WORK_HEIGHT_PX = 480;

/** 左端 8H ルーラーガター幅（現仕様では棒幅と同値） */
export const GANTT_RULER_GUTTER_WIDTH_PX = 4;

/** 8H 縦バー幅（ガター内の塗り幅。現仕様ではガター幅と同値） */
export const GANTT_RULER_BAR_WIDTH_PX = 4;

/**
 * 8H 境界探索と DOM セグメント数の固定上限（Pi/kiosk 向け）。
 * rulerHeightPx が大きくても反復回数と描画数はこの値で頭打ちになる。
 */
export const GANTT_RULER_MAX_BAND_COUNT = 64;

/** 設定可能な基準時間の上限（分）。64 帯上限と表示精度を壊さない範囲。 */
export const GANTT_MAX_CAPACITY_MINUTES = GANTT_EIGHT_HOURS_MINUTES * GANTT_RULER_MAX_BAND_COUNT;

/** ガント ON 時の仮想リスト overscan（OFF 時は leaderBoardRefetchPolicy の 3） */
export const GANTT_VIRTUAL_OVERSCAN = 2;
