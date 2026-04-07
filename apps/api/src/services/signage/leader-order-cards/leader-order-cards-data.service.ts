import { listProductionScheduleRows } from '../../production-schedule/production-schedule-query.service.js';
import { getResourceNameMapByResourceCds } from '../../production-schedule/resource-master.service.js';
import {
  normalizeConfiguredResourceCds,
  normalizeLeaderBoardRowsForSignage,
  sortLeaderBoardRowsForDisplaySignage,
  toLeaderOrderRowSvgModels,
  type SignageLeaderOrderSvgRow,
} from './leader-board-pure.js';
import { resolveSignageLeaderOrderQueryKeys } from './resolve-signage-leader-order-location.js';

export type LeaderOrderCardViewModel = {
  resourceCd: string;
  resourceJapaneseNames: string;
  rows: SignageLeaderOrderSvgRow[];
};

const MAX_PAGE_SIZE = 2000;

/**
 * 設定順の資源CDごとに、キオスク順位ボード相当の行を集めて閲覧用モデルへ変換する。
 */
export async function buildLeaderOrderCardViewModels(options: {
  deviceScopeKey: string;
  resourceCds: string[];
}): Promise<LeaderOrderCardViewModel[]> {
  const ordered = normalizeConfiguredResourceCds(options.resourceCds);
  if (ordered.length === 0) {
    return [];
  }

  const { locationKey, siteKey } = await resolveSignageLeaderOrderQueryKeys(options.deviceScopeKey);

  const { rows: rawRows } = await listProductionScheduleRows({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    queryText: '',
    productNos: [],
    assignedOnlyCds: [],
    resourceCds: ordered,
    resourceCategory: undefined,
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey,
    siteKey,
  });

  const normalized = normalizeLeaderBoardRowsForSignage(rawRows);
  const byCd = new Map<string, typeof normalized>();
  for (const row of normalized) {
    const list = byCd.get(row.resourceCd);
    if (list) {
      list.push(row);
    } else {
      byCd.set(row.resourceCd, [row]);
    }
  }

  const nameMap = await getResourceNameMapByResourceCds(ordered);

  return ordered.map((cd) => {
    const list = byCd.get(cd) ?? [];
    const sorted = sortLeaderBoardRowsForDisplaySignage(list);
    const names = nameMap[cd];
    const resourceJapaneseNames = Array.isArray(names)
      ? names.map((n) => String(n).trim()).filter((n) => n.length > 0).join(' · ')
      : '';
    return {
      resourceCd: cd,
      resourceJapaneseNames,
      rows: toLeaderOrderRowSvgModels(sorted),
    };
  });
}
