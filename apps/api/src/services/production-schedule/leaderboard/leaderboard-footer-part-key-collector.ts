import {
  buildLeaderboardPartFooterChipLookupKey,
  readTrimmedRowDataField,
  resolveLeaderboardRowSeibanJoinKeyForFooter
} from './leaderboard-part-footer-chip-key.js';
import { normalizeLeaderboardDisplayRowIdScope } from './leaderboard-display-row-scope.js';
import { parseDisplayItemId } from '../order-split/leaderboard-display-item-id.js';

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
 * DISTINCT ON 優先に使う親行 ID 集合。display item ID（`split:{uuid}` 含む）を
 * `CsvDashboardRow.id` へ解決して SQL winner 選定と揃える。
 */
export function resolveLeaderboardFooterPreferredRowIds(params: {
  rows: ReadonlyArray<{ id: string; sourceRowId?: string }>;
  preferredDisplayRowIds?: readonly string[] | undefined;
}): string[] {
  const { rows, preferredDisplayRowIds } = params;

  const displayItemIdToParentRowId = new Map<string, string>();
  for (const row of rows) {
    const displayId = row.id.trim();
    if (!displayId.length) continue;
    const parentRowId = row.sourceRowId?.trim() || displayId;
    displayItemIdToParentRowId.set(displayId, parentRowId);
  }

  const base =
    preferredDisplayRowIds !== undefined
      ? preferredDisplayRowIds
      : rows.map((r) => r.id.trim()).filter((id) => id.length > 0);

  const normalizedDisplayIds = normalizeLeaderboardDisplayRowIdScope(base);
  const parentRowIds: string[] = [];
  const seenParentRowIds = new Set<string>();

  for (const displayId of normalizedDisplayIds) {
    const mappedParentRowId = displayItemIdToParentRowId.get(displayId);
    if (mappedParentRowId) {
      if (!seenParentRowIds.has(mappedParentRowId)) {
        seenParentRowIds.add(mappedParentRowId);
        parentRowIds.push(mappedParentRowId);
      }
      continue;
    }

    const parsed = parseDisplayItemId(displayId);
    if (parsed?.kind === 'row' && !seenParentRowIds.has(parsed.sourceRowId)) {
      seenParentRowIds.add(parsed.sourceRowId);
      parentRowIds.push(parsed.sourceRowId);
    }
  }

  return parentRowIds;
}
