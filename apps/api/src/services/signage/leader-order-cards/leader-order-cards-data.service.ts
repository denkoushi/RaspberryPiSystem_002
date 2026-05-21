import { buildLeaderboardPartFooterChipLookupKey } from '../../production-schedule/leaderboard/leaderboard-part-footer-chip-key.js';
import { buildLeaderboardFooterChipsByPartKeyForScheduleRows } from '../../production-schedule/leaderboard/leaderboard-part-footer-processes.service.js';
import { listProductionScheduleRows } from '../../production-schedule/production-schedule-query.service.js';
import { getResourceNameMapByResourceCds } from '../../production-schedule/resource-master.service.js';
import {
  filterLeaderBoardRowsIncompleteForSignage,
  normalizeConfiguredResourceCds,
  normalizeLeaderBoardRowsForSignage,
  sortLeaderBoardRowsForDisplaySignage,
  toLeaderOrderRowSvgModels,
  type SignageLeaderBoardRow,
} from './leader-board-pure.js';
import { resolveSignageLeaderOrderQueryKeys } from './resolve-signage-leader-order-location.js';

export type LeaderOrderCardViewModel = {
  resourceCd: string;
  resourceJapaneseNames: string;
  rows: ReturnType<typeof toLeaderOrderRowSvgModels>;
};

const MAX_PAGE_SIZE = 2000;

function buildPartKeyForFooter(row: SignageLeaderBoardRow): string {
  return buildLeaderboardPartFooterChipLookupKey({
    seibanJoinKey: row.seibanJoinKey,
    productNo: row.productNo,
    fhincd: row.fhincd,
  });
}

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
  const incompleteRows = filterLeaderBoardRowsIncompleteForSignage(normalized);
  const footerChipsByPartKey = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
    rows: normalized.map((row) => ({
      id: row.id,
      seibanJoinKey: row.seibanJoinKey,
      rowData: {
        FSEIBAN: row.fseiban,
        ProductNo: row.productNo,
        FHINCD: row.fhincd,
      },
    })),
    locationKey,
    siteKey,
    preferredDisplayRowIds: incompleteRows.map((r) => r.id),
  });

  const byCd = new Map<string, SignageLeaderBoardRow[]>();
  for (const row of incompleteRows) {
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
      rows: toLeaderOrderRowSvgModels(sorted, footerChipsByPartKey, buildPartKeyForFooter),
    };
  });
}
