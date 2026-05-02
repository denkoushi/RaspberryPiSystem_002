/**
 * 順位ボード行と進捗一覧の部品行を同一粒度で結ぶ lookup キー（Web の
 * `buildLeaderBoardPartResourceProcessKey` と同一契約）。
 */
export function buildLeaderboardPartFooterChipLookupKey(parts: {
  seibanJoinKey: string;
  productNo: string;
  fhincd: string;
}): string {
  return [parts.seibanJoinKey.trim(), parts.productNo.trim(), parts.fhincd.trim()].join('\0');
}

export function resolveLeaderboardRowSeibanJoinKeyForFooter(row: {
  seibanJoinKey: string | null | undefined;
  rowData: unknown;
}): string {
  const join = typeof row.seibanJoinKey === 'string' ? row.seibanJoinKey.trim() : '';
  if (join.length > 0) return join;
  if (!row.rowData || typeof row.rowData !== 'object') return '';
  const v = (row.rowData as Record<string, unknown>).FSEIBAN;
  return typeof v === 'string' ? v.trim() : '';
}

export function readTrimmedRowDataField(rowData: unknown, key: string): string {
  if (!rowData || typeof rowData !== 'object') return '';
  const v = (rowData as Record<string, unknown>)[key];
  return typeof v === 'string' ? v.trim() : '';
}
