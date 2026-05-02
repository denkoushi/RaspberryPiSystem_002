import { aggregateResourceCdProcessChips } from '../productionSchedule/aggregateResourceCdProcessChips';

import type { ProductionScheduleProgressOverviewSeibanItem } from '../../../api/client';
import type { KioskResourceProgressProcessChip } from '../../../components/kiosk/resourceProgress/KioskResourceProcessChips';

/**
 * progress-overview の各部品プロセスから、順位ボード行下辺チップへ渡すデータを構築する。
 * Join キーは **生産日程一覧 API の `seibanJoinKey`** と **overview 側の `seibanJoinKey`**。
 */
export function buildLeaderBoardFooterResourceChipsBySeibanJoinKey(
  items: readonly ProductionScheduleProgressOverviewSeibanItem[]
): ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]> {
  const processesBySeibanJoinKey = new Map<
    string,
    Array<{ resourceCd: string; resourceNames?: string[]; isCompleted: boolean }>
  >();

  for (const item of items) {
    const seibanJoinKey = item.seibanJoinKey.trim();
    if (!seibanJoinKey.length) continue;
    for (const part of item.parts) {
      for (const proc of part.processes) {
        const cd = proc.resourceCd.trim();
        if (!cd.length) continue;

        let list = processesBySeibanJoinKey.get(seibanJoinKey);
        if (!list) {
          list = [];
          processesBySeibanJoinKey.set(seibanJoinKey, list);
        }
        list.push({
          resourceCd: proc.resourceCd,
          resourceNames: proc.resourceNames,
          isCompleted: proc.isCompleted
        });
      }
    }
  }

  const byJoinKey = new Map<string, readonly KioskResourceProgressProcessChip[]>();

  for (const [seibanJoinKey, flat] of processesBySeibanJoinKey) {
    byJoinKey.set(
      seibanJoinKey,
      aggregateResourceCdProcessChips(flat, (cd) => `lb-footer-${seibanJoinKey}-res-${cd}`)
    );
  }

  return byJoinKey;
}
