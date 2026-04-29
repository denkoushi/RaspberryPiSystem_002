/** 入力CDを順序どおり一意化する（順位ボードのスロット行と同等の運用）。 */
export function normalizeDistinctOrderedResourceCds(ordered: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ordered) {
    const t = String(raw ?? '').trim();
    if (!t.length || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 並びのみ差し替え、スロット本数は固定。入力はサーバ順（手動順資源一覧）またはローカルの順序リスト。
 */
export function applyOrderedResourceCdsToSlots(
  slotCount: number,
  orderedCds: readonly string[]
): Array<string | null> {
  const uniq = normalizeDistinctOrderedResourceCds(orderedCds);
  const out = Array.from({ length: slotCount }, () => null as string | null);
  let i = 0;
  for (let s = 0; s < out.length && i < uniq.length; s += 1) {
    out[s] = uniq[i];
    i += 1;
  }
  return out;
}
