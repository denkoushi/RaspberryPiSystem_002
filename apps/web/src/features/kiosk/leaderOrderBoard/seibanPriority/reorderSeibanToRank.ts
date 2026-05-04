/**
 * マージ済み一覧で指定製番を targetRank1Based（1始まり）の位置へ移動する。
 * 欠損製番・空・無効な順位は no-op。
 */
export function reorderSeibanToRank(
  merged: readonly string[],
  fseiban: string,
  targetRank1Based: number
): string[] {
  const key = fseiban.trim();
  if (!key) return [...merged];

  const list = [...merged];
  const from = list.findIndex((s) => s.trim() === key);
  if (from < 0) return list;

  const n = list.length;
  let toRank = Math.floor(Number(targetRank1Based));
  if (!Number.isFinite(toRank)) return list;
  toRank = Math.max(1, Math.min(n, toRank));
  const to = toRank - 1;

  if (from === to) return list;

  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return list;
}
