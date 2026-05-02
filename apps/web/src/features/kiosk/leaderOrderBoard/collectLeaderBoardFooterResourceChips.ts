import { collectAggregatedProgressOverviewResourceProcesses } from '../productionSchedule/collectAggregatedProgressOverviewResourceProcesses';

import type { ProductionScheduleProgressOverviewSeibanItem } from '../../../api/client';
import type { KioskResourceProgressProcessChip } from '../../../components/kiosk/resourceProgress/KioskResourceProcessChips';

/**
 * progress-overview の製番カード群から、順位ボード行下辺に表示する
 * 「製番 -> 集約済み資源 CD チップ列」の索引を構築する。
 */
export function buildLeaderBoardFooterResourceChipsBySeiban(
  items: readonly ProductionScheduleProgressOverviewSeibanItem[]
): ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]> {
  const bySeiban = new Map<string, readonly KioskResourceProgressProcessChip[]>();

  for (const item of items) {
    const fseiban = item.fseiban.trim();
    if (!fseiban.length) continue;
    bySeiban.set(fseiban, collectAggregatedProgressOverviewResourceProcesses(fseiban, item.parts));
  }

  return bySeiban;
}
