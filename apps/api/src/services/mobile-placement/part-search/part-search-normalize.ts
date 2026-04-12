/**
 * 部品名検索用の正規化（表記ゆれ吸収の前処理）。
 * マッチングは DB 側 ILIKE と併用する。
 */

export function normalizePartSearchQuery(input: string): string {
  return input.normalize('NFKC').trim();
}

/** ILIKE パターン内で `%` `_` `\` をエスケープ（`ESCAPE '\\'` 前提） */
export function escapeForIlike(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
