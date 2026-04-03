/**
 * Public contracts for signage SPLIT `splitCompact24` loan cards (SVG raster).
 * Keeps magic numbers and semantics in one place (Open/Closed: extend layout without scattering literals).
 *
 * Playwright / HTML ラスタの寸法・フォント係数は `loan-grid/html/grid-card-html-tokens.ts`
 *（描画経路は異なるが、列数・行数・最大行などの意味論は本ファイルを正とする）。
 */

/** 4×6 = 24 件までをカードグリッドに載せる（それ以上は overflow 表示）。 */
export const COMPACT24_MAX_COLUMNS = 4 as const;

export const COMPACT24_MAX_ROWS = 6 as const;

/** カード外寸の高さ（1920基準スケールで `cardHeightPx` に渡す値）。 */
export const COMPACT24_CARD_HEIGHT_PX = 154 as const;

/**
 * アイテム名（primary）と拠点（location）は SVG では `<text>` が自動折り返ししないため、
 * `loan-card-text.ts` の `splitIntoTwoLines` 系で論理的に **この行数まで** に分割してから描画する。
 */
export const COMPACT24_MAX_LINES_PRIMARY_OR_LOCATION = 2 as const;
