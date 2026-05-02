import { buildLeaderBoardPartResourceProcessKey } from './buildLeaderBoardPartResourceProcessKey';

import type { ProductionScheduleProgressOverviewSeibanItem } from '../../../api/client';
import type { KioskResourceProgressProcessChip } from '../../../components/kiosk/resourceProgress/KioskResourceProcessChips';

/**
 * progress-overview の各部品行 `part.processes` を、順位ボード行単位で引ける Map にする。
 * Join キーは `seibanJoinKey + productNo + fhincd` の部品キー。
 */
export function buildLeaderBoardFooterResourceChipsByPartKey(
  items: readonly ProductionScheduleProgressOverviewSeibanItem[]
): ReadonlyMap<string, readonly KioskResourceProgressProcessChip[]> {
  const byPartKey = new Map<string, readonly KioskResourceProgressProcessChip[]>();

  for (const item of items) {
    const seibanJoinKey = item.seibanJoinKey.trim();
    if (!seibanJoinKey.length) continue;
    for (const part of item.parts) {
      const partKey = buildLeaderBoardPartResourceProcessKey({
        seibanJoinKey,
        productNo: part.productNo,
        fhincd: part.fhincd
      });
      byPartKey.set(partKey, [...part.processes]);
    }
  }

  return byPartKey;
}
