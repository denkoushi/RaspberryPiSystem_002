/**
 * 順位ボード左パネル「製番 OR 検索」用の純粋モデル。
 * 生産スケジュール等の {@link activeQueries} トグルと同趣旨だが、順位ボード専用の境界に閉じる。
 */

/** 一覧に含まれるか確認（完全一致） */
export function isSeibanFilterSelected(filters: readonly string[], fseiban: string): boolean {
  return filters.some((item) => item === fseiban);
}

/** OR 検索セットをトグル。 */
export function toggleSeibanFilter(filters: readonly string[], fseiban: string): string[] {
  const trimmed = fseiban.trim();
  if (trimmed.length === 0) return [...filters];

  const exists = filters.some((item) => item === trimmed);
  if (exists) {
    return filters.filter((item) => item !== trimmed);
  }
  const next = [...filters, trimmed];
  return next;
}

/**
 * 登録（applySearch）時: ヒストリに載った製番をフィルタに必ず含めたい場合に使う。
 * 既に含まれていれば順序のみ維持（先頭への移動はしない）。
 */
export function ensureSeibanInFilters(filters: readonly string[], fseiban: string): string[] {
  const trimmed = fseiban.trim();
  if (trimmed.length === 0) return [...filters];
  if (filters.some((item) => item === trimmed)) return [...filters];
  const next = [...filters, trimmed];
  return next;
}
