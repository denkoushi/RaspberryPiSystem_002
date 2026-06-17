/** 人工数 lookup キー: ProductNo + FKOJUN（表示行と FSIGENCD=10 行の突合） */
export function buildLeaderboardLaborLookupKey(productNo: string, fkojun: string): string {
  return `${productNo.trim()}\0${fkojun.trim()}`;
}

export function extractLeaderboardLaborLookupKeyFromRowData(
  rowData: Record<string, unknown> | null | undefined
): { productNo: string; fkojun: string; key: string } | null {
  if (!rowData || typeof rowData !== 'object') return null;
  const productNo = typeof rowData.ProductNo === 'string' ? rowData.ProductNo.trim() : '';
  const fkojun = typeof rowData.FKOJUN === 'string' ? rowData.FKOJUN.trim() : '';
  if (!productNo.length || !fkojun.length) return null;
  return { productNo, fkojun, key: buildLeaderboardLaborLookupKey(productNo, fkojun) };
}

export function extractResourceCdFromRowData(rowData: Record<string, unknown> | null | undefined): string {
  if (!rowData || typeof rowData !== 'object') return '';
  const raw = rowData.FSIGENCD;
  return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}
