/**
 * 購買CSVの FHINCD（記号付き）を、表示・従来互換用に軽く正規化する。
 * 括弧内の付加表記を除去する（例: MD000552918(A) → MD000552918）。
 */
export function normalizePurchaseFhinCdForScheduleLookup(raw: string): string {
  // Linear scan instead of /\([^)]*\)/g, which backtracks on many unclosed '('.
  const text = String(raw ?? '').trim();
  let out = '';
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf('(', index);
    const close = open < 0 ? -1 : text.indexOf(')', open + 1);
    if (close < 0) { out += text.slice(index); break; }
    out += text.slice(index, open);
    index = close + 1;
  }
  return out.trim();
}

/**
 * 末尾の `-001` / `-001-1` のような **数値のみ** のハイフン枝番を除去する。
 * `-SA` / `-002T` のように英字を含む末尾は残す。
 */
export function stripTrailingNumericHyphenSuffixes(code: string): string {
  // Strip from the end instead of /(-[0-9]+)+$/, which backtracks on long '-0' runs.
  const text = String(code ?? '');
  let end = text.length;
  for (;;) {
    let start = end;
    while (start > 0 && text[start - 1] >= '0' && text[start - 1] <= '9') start -= 1;
    if (start === end || start === 0 || text[start - 1] !== '-') break;
    end = start - 1;
  }
  return text.slice(0, end).trim();
}

/**
 * 生産日程 `FHINCD` との照合キー（括弧除去 + 末尾数値枝番除去）。
 * `normalizePurchaseFhinCdForScheduleLookup` と同一の順序で適用する。
 */
export function normalizePurchaseFhinCdForMatching(raw: string): string {
  return stripTrailingNumericHyphenSuffixes(normalizePurchaseFhinCdForScheduleLookup(raw));
}

