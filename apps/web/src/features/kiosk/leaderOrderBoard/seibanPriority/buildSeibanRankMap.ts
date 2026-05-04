/** マージ済み製番リストの先頭ほど「小さい」ランク（昇順ソートで先に来る） */
export function buildSeibanRankMapFromMergedOrder(mergedFseibanOrder: readonly string[]): ReadonlyMap<string, number> {
  const m = new Map<string, number>();
  mergedFseibanOrder.forEach((raw, index) => {
    const t = raw.trim();
    if (t.length === 0) return;
    if (!m.has(t)) {
      m.set(t, index);
    }
  });
  return m;
}
