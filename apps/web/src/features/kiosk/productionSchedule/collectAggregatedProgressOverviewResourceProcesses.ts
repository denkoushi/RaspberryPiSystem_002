import { aggregateResourceCdProcessChips, type AggregatedResourceCdProcessChip } from './aggregateResourceCdProcessChips';

import type { ProductionScheduleProgressOverviewPartItem } from '../../../api/client';

export type AggregatedProgressOverviewResourceProcess = AggregatedResourceCdProcessChip;

/**
 * 製番カード単位で部品行の資源進捗を資源 CD ごとに集約する（表示専用・純関数）。
 * - 完了表示: **同一 CD のすべてのプロセスが isCompleted のときのみ** true。
 * - 並び: **resourceCd 昇順**。
 */
export function collectAggregatedProgressOverviewResourceProcesses(
  fseiban: string,
  parts: readonly ProductionScheduleProgressOverviewPartItem[]
): readonly AggregatedProgressOverviewResourceProcess[] {
  const flat: Array<{ resourceCd: string; resourceNames?: string[]; isCompleted: boolean }> = [];
  for (const part of parts) {
    for (const proc of part.processes) {
      flat.push({
        resourceCd: proc.resourceCd,
        resourceNames: proc.resourceNames,
        isCompleted: proc.isCompleted
      });
    }
  }
  const trimmedSeiban = fseiban.trim();
  const rowIdPrefix = trimmedSeiban.length ? `overview-${trimmedSeiban}-res` : 'overview-res';
  return aggregateResourceCdProcessChips(flat, (cd) => `${rowIdPrefix}-${cd}`);
}
