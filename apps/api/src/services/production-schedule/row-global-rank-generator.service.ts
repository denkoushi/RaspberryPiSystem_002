import {
  listGlobalRowRankPartPriorities,
  listGlobalRowRankTargets,
  listGlobalSeibanRankSeeds,
  replaceGlobalRowRanks,
  type GlobalRowRankTargetRow,
} from './row-global-rank.repository.js';

const DEFAULT_PART_PRIORITY = Number.MAX_SAFE_INTEGER;
const DEFAULT_NUMERIC_ORDER = Number.MAX_SAFE_INTEGER;

const toStableNumber = (value: string): number => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_NUMERIC_ORDER;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : DEFAULT_NUMERIC_ORDER;
};

const compareStrings = (left: string, right: string): number => left.localeCompare(right, 'ja');

export async function regenerateProductionScheduleGlobalRowRank(params: {
  locationKey: string;
  sourceType?: 'auto' | 'manual';
}): Promise<{
  generatedCount: number;
  rankedFseibanCount: number;
}> {
  const sourceType = params.sourceType ?? 'manual';
  const seibanRanks = await listGlobalSeibanRankSeeds(params.locationKey);
  const rankedFseibans = seibanRanks.map((row) => row.fseiban);
  if (rankedFseibans.length === 0) {
    await replaceGlobalRowRanks({
      locationKey: params.locationKey,
      sourceType,
      rankedRows: []
    });
    return {
      generatedCount: 0,
      rankedFseibanCount: 0
    };
  }

  const [targets, partPriorities] = await Promise.all([
    listGlobalRowRankTargets({
      locationKey: params.locationKey,
      targetFseibans: rankedFseibans
    }),
    listGlobalRowRankPartPriorities({
      locationKey: params.locationKey,
      targetFseibans: rankedFseibans
    })
  ]);

  const seibanPriorityMap = new Map(seibanRanks.map((row) => [row.fseiban, row.priorityOrder]));
  const partPriorityMap = new Map(partPriorities.map((row) => [`${row.fseiban}::${row.fhincd}`, row.priorityRank]));
  const sorted = [...targets].sort((left, right) => {
    const seibanOrderDiff =
      (seibanPriorityMap.get(left.fseiban) ?? DEFAULT_NUMERIC_ORDER) -
      (seibanPriorityMap.get(right.fseiban) ?? DEFAULT_NUMERIC_ORDER);
    if (seibanOrderDiff !== 0) return seibanOrderDiff;

    const partOrderDiff =
      (partPriorityMap.get(`${left.fseiban}::${left.fhincd}`) ?? DEFAULT_PART_PRIORITY) -
      (partPriorityMap.get(`${right.fseiban}::${right.fhincd}`) ?? DEFAULT_PART_PRIORITY);
    if (partOrderDiff !== 0) return partOrderDiff;

    const fkojunDiff = toStableNumber(left.fkojun) - toStableNumber(right.fkojun);
    if (fkojunDiff !== 0) return fkojunDiff;

    const productNoDiff = toStableNumber(left.productNo) - toStableNumber(right.productNo);
    if (productNoDiff !== 0) return productNoDiff;

    const fhincdDiff = compareStrings(left.fhincd, right.fhincd);
    if (fhincdDiff !== 0) return fhincdDiff;

    return compareStrings(left.csvDashboardRowId, right.csvDashboardRowId);
  });

  const rankedRows = sorted.map((row: GlobalRowRankTargetRow, index) => ({
    csvDashboardRowId: row.csvDashboardRowId,
    fseiban: row.fseiban,
    globalRank: index + 1
  }));

  await replaceGlobalRowRanks({
    locationKey: params.locationKey,
    sourceType,
    rankedRows
  });

  return {
    generatedCount: rankedRows.length,
    rankedFseibanCount: rankedFseibans.length
  };
}
