import type { ProductionScheduleProgressOverviewPartItem } from '../../../api/client';

export type AggregatedProgressOverviewResourceProcess = Readonly<{
  rowId: string;
  resourceCd: string;
  resourceNames?: string[];
  isCompleted: boolean;
}>;

type AggBucket = {
  /** 同一資源 CD のすべてのプロセスが完了のときのみ true（AND） */
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
 * 製番カード単位で部品行の資源進捗を資源 CD ごとに集約する（表示専用・純関数）。
 * - 完了表示: **同一 CD のすべてのプロセスが isCompleted のときのみ** true。
 * - 並び: **resourceCd 昇順**。
 */
export function collectAggregatedProgressOverviewResourceProcesses(
  fseiban: string,
  parts: readonly ProductionScheduleProgressOverviewPartItem[]
): readonly AggregatedProgressOverviewResourceProcess[] {
  const trimmedSeiban = fseiban.trim();
  const map = new Map<string, AggBucket>();

  for (const part of parts) {
    for (const proc of part.processes) {
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
  }

  const sortedCds = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));

  const rowIdPrefix = trimmedSeiban.length ? `overview-${trimmedSeiban}-res` : 'overview-res';

  return sortedCds.map((cd): AggregatedProgressOverviewResourceProcess => {
    const bucket = map.get(cd)!;
    const base: AggregatedProgressOverviewResourceProcess = {
      rowId: `${rowIdPrefix}-${cd}`,
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
