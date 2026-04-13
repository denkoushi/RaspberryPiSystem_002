/**
 * 部品名検索用の正規化（表記ゆれ吸収の前処理）。
 * DB 側 ILIKE およびクライアント側剪定の両方で同一の前提にする。
 */
export function normalizePartSearchQuery(input: string): string {
  return input.normalize('NFKC').trim();
}
