/**
 * 購買CSVの FHINCD（記号付き）を、生産日程本体の FHINCD と突き合わせるための正規化。
 * 括弧内の付加表記を除去する（例: MD000552918(A) → MD000552918）。
 */
export function normalizePurchaseFhinCdForScheduleLookup(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\([^)]*\)/g, '')
    .trim();
}
