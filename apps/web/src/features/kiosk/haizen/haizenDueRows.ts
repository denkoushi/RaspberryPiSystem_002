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

/** 置いた部品と未配置の部品を、製番ごとの納期（部品完成日）の早い順に並べる。 */
export function buildHaizenDueRows(rows: readonly HaizenOverviewRow[], unplacedRows: readonly HaizenListRow[]): HaizenListRow[] {
  const dueRows: HaizenListRow[] = [...rows, ...unplacedRows];
  const groupDates = new Map<string | null, string | null>();
  for (const row of dueRows) {
    const date = groupDates.get(row.fseiban);
    if (!groupDates.has(row.fseiban) || (row.dueDate && (!date || row.dueDate < date))) groupDates.set(row.fseiban, row.dueDate);
  }
  return dueRows.sort((a, b) => {
    const aDate = groupDates.get(a.fseiban), bDate = groupDates.get(b.fseiban);
    const dateOrder = aDate === bDate ? 0 : !aDate ? 1 : !bDate ? -1 : aDate.localeCompare(bDate);
    const groupOrder = dateOrder || (a.fseiban ?? '').localeCompare(b.fseiban ?? '');
    const rank = (row: HaizenListRow) => row.unplaced ? (row.verified ? 1 : 0) : 2;
    return groupOrder || rank(a) - rank(b) || (a.unplaced && b.unplaced ? a.manufacturingOrderBarcodeRaw.localeCompare(b.manufacturingOrderBarcodeRaw) : haizenNewest(a, b));
  });
}
