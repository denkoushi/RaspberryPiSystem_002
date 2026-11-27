import type { HaizenOverviewRow, HaizenUnplacedPart } from '../../../api/domains/mobile-placement';

export type HaizenListRow = HaizenOverviewRow & { unplaced?: boolean };

export const haizenNewest = (a: HaizenOverviewRow, b: HaizenOverviewRow) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id);

export const materialArrivalKey = (fseiban: string, fhincd: string) => `${fseiban}\t${fhincd}`;

export function buildHaizenUnplacedRows(unplacedParts: readonly HaizenUnplacedPart[]): HaizenListRow[] {
  return unplacedParts.map(part => ({
    ...part, id: `${part.fseiban}:${part.productNo}`, source: 'branch', unplaced: true,
    manufacturingOrderBarcodeRaw: part.productNo, shelfCodeRaw: '', branchNo: null, updatedAt: '', sendOutDate: null
  }));
}

const earliestDue = (a: string | null, b: string | null) => b && (!a || b < a) ? b : a;
const compareDue = (a: string | null, b: string | null) => a === b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b);
const rowRank = (row: HaizenListRow) => row.unplaced ? (row.verified ? 1 : 0) : 2;
const comparePartRows = (a: HaizenListRow, b: HaizenListRow) => rowRank(a) - rowRank(b) ||
  (a.unplaced && b.unplaced ? a.manufacturingOrderBarcodeRaw.localeCompare(b.manufacturingOrderBarcodeRaw) : haizenNewest(a, b));

/** 置いた部品と未配置の部品を、製番ごとの納期（部品完成日）の早い順に並べる。 */
export function buildHaizenDueRows(rows: readonly HaizenOverviewRow[], unplacedRows: readonly HaizenListRow[]): HaizenListRow[] {
  const dueRows: HaizenListRow[] = [...rows, ...unplacedRows];
  const groupDates = new Map<string | null, string | null>();
  for (const row of dueRows) {
    groupDates.set(row.fseiban, earliestDue(groupDates.get(row.fseiban) ?? null, row.dueDate));
  }
  return dueRows.sort((a, b) => compareDue(groupDates.get(a.fseiban) ?? null, groupDates.get(b.fseiban) ?? null) ||
    (a.fseiban ?? '').localeCompare(b.fseiban ?? '') || comparePartRows(a, b));
}

type HaizenDueGroup = {
  fseiban: string | null;
  machineName: string | null;
  dueDate: string | null;
  rows: HaizenListRow[];
  verified: number;
  placed: number;
};

export function buildHaizenDueGroups(rows: readonly HaizenListRow[], seibanOrder: readonly string[], excludedFseibans: readonly string[]) {
  const ranks = new Map(seibanOrder.map((fseiban, index) => [fseiban, index]));
  const excluded = new Set(excludedFseibans);
  const groups = new Map<string | null, HaizenDueGroup>();
  for (const row of rows) {
    if (row.fseiban && excluded.has(row.fseiban)) continue;
    let group = groups.get(row.fseiban);
    if (!group) {
      group = { fseiban: row.fseiban, machineName: null, dueDate: null, rows: [], verified: 0, placed: 0 };
      groups.set(row.fseiban, group);
    }
    group.rows.push(row);
    group.machineName ||= row.machineName;
    group.dueDate = earliestDue(group.dueDate, row.dueDate);
    group.verified += Number(row.verified);
    group.placed += Number(!row.unplaced);
  }
  for (const group of groups.values()) group.rows.sort(comparePartRows);
  const rank = (fseiban: string | null) => ranks.get(fseiban ?? '') ?? ranks.size;
  return [...groups.values()].sort((a, b) => rank(a.fseiban) - rank(b.fseiban) ||
    compareDue(a.dueDate, b.dueDate) || (a.fseiban ?? '').localeCompare(b.fseiban ?? ''));
}

/** 分配の表記。未設定は「—」、0 は「なし」。 */
export const formatHaizenBranch = (branchNo: number | null | undefined) => branchNo == null ? '—' : branchNo === 0 ? 'なし' : String(branchNo);
