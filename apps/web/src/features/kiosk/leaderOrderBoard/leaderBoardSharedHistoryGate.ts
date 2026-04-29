/**
 * 順位ボード: 製番フィルタを ON にする前にサーバ共有履歴へ載せる必要があるか判定する純粋関数。
 * UI/IO から分離してテスト容易性を確保する。
 */
export function requiresSharedHistoryInsertBeforeEnableFilter(
  sharedHistory: readonly string[],
  fseiban: string
): boolean {
  const trimmed = fseiban.trim();
  if (trimmed.length === 0) return false;
  return !sharedHistory.some((item) => item === trimmed);
}
