/**
 * 登録製番履歴の並び替えロジックを提供する純粋関数。
 * 左右移動は隣接1つずつ。UIから分離し、将来のドラッグ&ドロップでも再利用可能。
 */

/**
 * 指定した製番を左に1つ移動する。
 * 先頭の場合は no-op（元配列をそのまま返す）。
 *
 * @param history - 現在の履歴配列
 * @param value - 移動対象の製番
 * @returns 移動後の履歴配列（対象未存在時は元配列）
 */
export function moveHistoryItemLeft(history: string[], value: string): string[] {
  const idx = history.indexOf(value);
  if (idx <= 0 || idx === -1) {
    return history;
  }
  const next = [...history];
  [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
  return next;
}

/**
 * 指定した製番を右に1つ移動する。
 * 末尾の場合は no-op（元配列をそのまま返す）。
 *
 * @param history - 現在の履歴配列
 * @param value - 移動対象の製番
 * @returns 移動後の履歴配列（対象未存在時は元配列）
 */
export function moveHistoryItemRight(history: string[], value: string): string[] {
  const idx = history.indexOf(value);
  if (idx === -1 || idx >= history.length - 1) {
    return history;
  }
  const next = [...history];
  [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
  return next;
}
