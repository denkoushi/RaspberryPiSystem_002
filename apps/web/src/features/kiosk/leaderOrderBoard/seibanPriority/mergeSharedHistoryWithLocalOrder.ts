/**
 * 共有履歴 `sharedHistory` の内容を維持しつつ、`localOrder` で上書きした表示順を作る。
 * - 先に local 側の順で、まだ共有に存在する製番だけを列挙
 * - 残りを `sharedHistory` の順で付け足す
 */
export function mergeSharedHistoryWithLocalOrder(
  sharedHistory: readonly string[],
  localOrder: readonly string[]
): string[] {
  const normalizedShared = sharedHistory.map((s) => s.trim()).filter((s) => s.length > 0);
  const sharedSet = new Set(normalizedShared);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of localOrder) {
    const t = raw.trim();
    if (!t || !sharedSet.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }

  for (const t of normalizedShared) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }

  return out;
}
