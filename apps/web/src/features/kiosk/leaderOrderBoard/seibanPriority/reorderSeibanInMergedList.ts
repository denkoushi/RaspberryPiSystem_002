/**
 * マージ済み一覧で隣接要素と入れ替える。境界外は no-op。
 */
export function reorderSeibanInMergedList(
  merged: readonly string[],
  fseiban: string,
  direction: 'up' | 'down'
): string[] {
  const key = fseiban.trim();
  if (!key) return [...merged];

  const list = [...merged];
  const i = list.findIndex((s) => s.trim() === key);
  if (i < 0) return list;

  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return list;

  const tmp = list[i];
  list[i] = list[j]!;
  list[j] = tmp!;
  return list;
}
