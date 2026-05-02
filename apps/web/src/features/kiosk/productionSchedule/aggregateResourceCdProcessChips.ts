/**
 * 進捗 overview / 順位ボードで共有する資源 CD 単位チップデータの集約（純関数）。
 * 「同一 resourceCd で AND 完了・名称は順序安定でマージ」ルールのみを担当する。
 */

export type AggregatedResourceCdProcessChip = Readonly<{
  rowId: string;
  resourceCd: string;
  resourceNames?: string[];
  isCompleted: boolean;
}>;

export type ResourceCdProcessChipInput = Readonly<{
  resourceCd: string;
  resourceNames?: string[];
  isCompleted: boolean;
}>;

type AggBucket = {
  allCompleted: boolean;
  resourceNames: string[];
};

function mergeUniqueSequential(names?: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of names ?? []) {
    const t = n.trim();
    if (!t.length || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function appendUniqueSequential(base: readonly string[], add?: readonly string[]): string[] {
  const out = [...base];
  const seen = new Set(base.map((s) => s.trim()).filter(Boolean));
  for (const n of add ?? []) {
    const t = n.trim();
    if (!t.length || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * 任意の資源進捗行を resourceCd で集約し、チップ行を返す。
 * @param chipRowIdForResourceCd React key 兼 rowId（CD 単位で一意）
 */
export function aggregateResourceCdProcessChips(
  processes: readonly ResourceCdProcessChipInput[],
  chipRowIdForResourceCd: (resourceCd: string) => string
): readonly AggregatedResourceCdProcessChip[] {
  const map = new Map<string, AggBucket>();

  for (const proc of processes) {
    const cd = proc.resourceCd.trim();
    if (!cd.length) continue;

    const existing = map.get(cd);
    if (!existing) {
      map.set(cd, {
        allCompleted: proc.isCompleted,
        resourceNames: mergeUniqueSequential(proc.resourceNames)
      });
      continue;
    }
    existing.allCompleted = existing.allCompleted && proc.isCompleted;
    existing.resourceNames = appendUniqueSequential(existing.resourceNames, proc.resourceNames);
  }

  const sortedCds = Array.from(map.keys()).sort((a, b) => a.localeCompare(b, 'ja'));

  return sortedCds.map((cd): AggregatedResourceCdProcessChip => {
    const bucket = map.get(cd)!;
    const base: AggregatedResourceCdProcessChip = {
      rowId: chipRowIdForResourceCd(cd),
      resourceCd: cd,
      isCompleted: bucket.allCompleted
    };
    if (bucket.resourceNames.length === 0) {
      return base;
    }
    return {
      ...base,
      resourceNames: bucket.resourceNames
    };
  });
}
