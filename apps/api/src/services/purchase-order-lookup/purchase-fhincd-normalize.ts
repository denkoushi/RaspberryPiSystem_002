/**
 * 購買CSVの FHINCD（記号付き）を、表示・従来互換用に軽く正規化する。
 * 括弧内の付加表記を除去する（例: MD000552918(A) → MD000552918）。
 */
export function normalizePurchaseFhinCdForScheduleLookup(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\([^)]*\)/g, '')
    .trim();
}

/**
 * 末尾の `-001` / `-001-1` のような **数値のみ** のハイフン枝番を除去する。
 * `-SA` / `-002T` のように英字を含む末尾は残す。
 */
export function stripTrailingNumericHyphenSuffixes(code: string): string {
  return String(code ?? '').replace(/(-[0-9]+)+$/g, '').trim();
}

/**
 * 生産日程 `FHINCD` との照合キー（括弧除去 + 末尾数値枝番除去）。
 * `normalizePurchaseFhinCdForScheduleLookup` と同一の順序で適用する。
 */
export function normalizePurchaseFhinCdForMatching(raw: string): string {
  return stripTrailingNumericHyphenSuffixes(normalizePurchaseFhinCdForScheduleLookup(raw));
}

