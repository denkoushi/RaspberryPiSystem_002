const DEFAULT_NUMERIC_ORDER = Number.MAX_SAFE_INTEGER;

export type DisplayRankSourceRow = {
  id: string;
  globalRank: number | null;
  fseiban: string;
  productNo: string;
  fkojun: string;
};

const toStableNumber = (value: string): number => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return DEFAULT_NUMERIC_ORDER;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : DEFAULT_NUMERIC_ORDER;
};

const compareStrings = (left: string, right: string): number => left.localeCompare(right, 'ja');

const compareRows = (left: DisplayRankSourceRow, right: DisplayRankSourceRow): number => {
  const leftGlobalRank = left.globalRank ?? DEFAULT_NUMERIC_ORDER;
  const rightGlobalRank = right.globalRank ?? DEFAULT_NUMERIC_ORDER;
  const globalRankDiff = leftGlobalRank - rightGlobalRank;
  if (globalRankDiff !== 0) return globalRankDiff;

  const fseibanDiff = compareStrings(left.fseiban, right.fseiban);
  if (fseibanDiff !== 0) return fseibanDiff;

  const productNoDiff = toStableNumber(left.productNo) - toStableNumber(right.productNo);
  if (productNoDiff !== 0) return productNoDiff;

  const fkojunDiff = toStableNumber(left.fkojun) - toStableNumber(right.fkojun);
  if (fkojunDiff !== 0) return fkojunDiff;

  return compareStrings(left.id, right.id);
};

export const buildResourceLocalRankMap = (
  rows: DisplayRankSourceRow[]
): Map<string, number> => {
  const rankedRows = [...rows]
    .filter((row) => typeof row.globalRank === 'number')
    .sort(compareRows);

  const rankByRowId = new Map<string, number>();
  rankedRows.forEach((row, index) => {
    rankByRowId.set(row.id, index + 1);
  });
  return rankByRowId;
};
