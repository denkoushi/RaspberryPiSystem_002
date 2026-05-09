import {
  buildLeaderboardPartFooterChipLookupKey,
  readTrimmedRowDataField,
  resolveLeaderboardRowSeibanJoinKeyForFooter
} from './leaderboard-part-footer-chip-key.js';
import { normalizeLeaderboardDisplayRowIdScope } from './leaderboard-display-row-scope.js';

export type LeaderboardFooterPartTriple = {
  seibanJoinKey: string;
  productNo: string;
  fhincd: string;
};

/**
 * 入力行から部品キー（フッタ map の粒度）を一意に収集する。順序は初出順（Web の partKey 契約と一致）。
 */
export function collectLeaderboardFooterPartKeysFromRows(
  rows: ReadonlyArray<{
    seibanJoinKey: string | null | undefined;
    rowData: unknown;
  }>
): {
  uniquePartKeysInOrder: string[];
  tripleByPartKey: Map<string, LeaderboardFooterPartTriple>;
} {
  const uniquePartKeysInOrder: string[] = [];
  const tripleByPartKey = new Map<string, LeaderboardFooterPartTriple>();
  const seen = new Set<string>();

  for (const row of rows) {
    const seibanJoinKey = resolveLeaderboardRowSeibanJoinKeyForFooter(row);
    const productNo = readTrimmedRowDataField(row.rowData, 'ProductNo');
    const fhincd = readTrimmedRowDataField(row.rowData, 'FHINCD');
    if (!seibanJoinKey.length || !fhincd.length) continue;

    const key = buildLeaderboardPartFooterChipLookupKey({ seibanJoinKey, productNo, fhincd });
    if (seen.has(key)) continue;
    seen.add(key);
    uniquePartKeysInOrder.push(key);
    tripleByPartKey.set(key, { seibanJoinKey, productNo, fhincd });
  }

  return { uniquePartKeysInOrder, tripleByPartKey };
}

/**
 * DISTINCT ON 優先に使う「表示中 rowId」集合。明示が無ければ `rows` の id を用いる（後方互換）。
 */
export function resolveLeaderboardFooterPreferredRowIds(params: {
  rows: ReadonlyArray<{ id: string }>;
  preferredDisplayRowIds?: readonly string[] | undefined;
}): string[] {
  const { rows, preferredDisplayRowIds } = params;
  const base =
    preferredDisplayRowIds !== undefined
      ? preferredDisplayRowIds
      : rows.map((r) => r.id.trim()).filter((id) => id.length > 0);
  return normalizeLeaderboardDisplayRowIdScope(base);
}
