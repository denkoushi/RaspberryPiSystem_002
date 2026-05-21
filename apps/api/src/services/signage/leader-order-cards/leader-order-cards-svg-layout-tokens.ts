/**
 * 順位ボード資源カード SVG のレイアウト係数（タイポ・ストローク・文字幅の粗い近似）。
 * 表示調整は主にこのファイルと `leader-order-cards-svg-theme.ts` で完結させ、
 * 描画モジュールは「何を描くか」に集中する（定数の単一情報源）。
 */

/** サイネージ行の機種名（`machineName`）表示上限（超過は `…`） */
export const LEADER_ORDER_SIGNAGE_MACHINE_NAME_MAX_CHARS = 10;

/** 等幅寄りラベル（資源CD・工順）の平均文字幅 ≈ fontSize × ratio */
export const LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MONO = 0.55;

/** 日本語混在テキストの平均文字幅 ≈ fontSize × ratio（全角をざっくり） */
export const LEADER_ORDER_SVG_AVG_CHAR_WIDTH_MIXED = 0.95;

/** 本文（ラテン混在）の折り返し幅 */
export const LEADER_ORDER_SVG_AVG_CHAR_WIDTH_BODY = 0.55;

/** 小さめ行の折り返し幅 */
export const LEADER_ORDER_SVG_AVG_CHAR_WIDTH_SMALL = 0.52;

export const LEADER_ORDER_SVG_CARD_OUTER_STROKE_WIDTH = 1;
export const LEADER_ORDER_SVG_ROW_STROKE_WIDTH = 1;
/** 製番左縁（`border-l-4` 相当・px） */
export const LEADER_ORDER_SVG_ROW_SEIBAN_ACCENT_WIDTH_SCALE = 4;

/** ヘッダ1行テキストのベースライン: cardPad + titleFs × factor（y0 からの相対ではなく card 内側上端から） */
export const LEADER_ORDER_SVG_HEADER_BASELINE_TITLE_FACTOR = 0.88;
