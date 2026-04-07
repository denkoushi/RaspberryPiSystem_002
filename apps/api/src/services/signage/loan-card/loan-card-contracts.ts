/**
 * Public contracts for signage SPLIT `splitCompact24` loan cards (Playwright HTML + SVG レガシ共通のグリッド寸法).
 * Keeps magic numbers and semantics in one place (Open/Closed: extend layout without scattering literals).
 *
 * Playwright HTML compact と SVG レガシでパディングのみ異なり得る（高さ・列/行グリッドは共通）。
 * HTML の compact 専用値は `COMPACT24_HTML_*`、SVG の内側余白は `COMPACT24_SVG_CARD_PAD_PX`。
 *
 * Playwright / HTML のデフォルト（非 compact）カードは `grid-card-html-tokens.ts` の `computeGridCardSpacingTokens` の pad=12。
 */

/** 4×6 = 24 件までをカードグリッドに載せる（それ以上は overflow 表示）。 */
export const COMPACT24_MAX_COLUMNS = 4 as const;

export const COMPACT24_MAX_ROWS = 6 as const;

/** カード外寸の高さ（1920基準スケールで `cardHeightPx` に渡す値）。HTML / SVG 共通。 */
export const COMPACT24_CARD_HEIGHT_PX = 164 as const;

/**
 * Playwright `splitCompact24` compact カードの padding（scale 1 基準 px）。
 * フッタ（日時・管理番号）用の縦余白確保のため 12 より詰める。サムネ 96px は維持。
 */
export const COMPACT24_HTML_CARD_PAD_PX = 10 as const;

/**
 * SVG レガシ `splitCompact24` の内側パディング（scale 1 基準 px）。
 */
export const COMPACT24_SVG_CARD_PAD_PX = 12 as const;

/**
 * compact HTML の氏名行直下マージン（scale 1 基準 px）。
 */
export const COMPACT24_HTML_NAME_MARGIN_BOTTOM_PX = 3 as const;

/**
 * アイテム名（primary）と拠点（location）は SVG では `<text>` が自動折り返ししないため、
 * `loan-card-text.ts` の `splitIntoTwoLines` 系で論理的に **この行数まで** に分割してから描画する。
 */
export const COMPACT24_MAX_LINES_PRIMARY_OR_LOCATION = 2 as const;
