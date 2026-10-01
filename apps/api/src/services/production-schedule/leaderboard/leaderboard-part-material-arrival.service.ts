import type { MaterialArrivalStatus } from '@raspi-system/shared-types';

import {
  findMaterialArrivalStatusByPart,
  materialArrivalLookupKey
} from '../../purchase-order-lookup/material-arrival-status.service.js';
import {
  buildLeaderboardPartFooterChipLookupKey,
  readTrimmedRowDataField,
  resolveLeaderboardRowSeibanJoinKeyForFooter
} from './leaderboard-part-footer-chip-key.js';

/**
 * 順位ボード行の部品キー（工程チップと同じ粒度）ごとに材料の入荷状況を返す。
 * 材料の購買行が無い部品はキーを含めない。
 */
export async function buildLeaderboardMaterialArrivalByPartKeyForScheduleRows(
  rows: ReadonlyArray<{ seibanJoinKey: string | null | undefined; rowData: unknown }>
): Promise<Record<string, MaterialArrivalStatus>> {
  const partByPartKey = new Map<string, { fseiban: string; fhincd: string }>();
  for (const row of rows) {
    const seibanJoinKey = resolveLeaderboardRowSeibanJoinKeyForFooter(row);
    const fseiban = readTrimmedRowDataField(row.rowData, 'FSEIBAN');
    const fhincd = readTrimmedRowDataField(row.rowData, 'FHINCD');
    if (!seibanJoinKey.length || !fseiban.length || !fhincd.length) continue;
    const partKey = buildLeaderboardPartFooterChipLookupKey({
      seibanJoinKey,
      productNo: readTrimmedRowDataField(row.rowData, 'ProductNo'),
      fhincd
    });
    if (!partByPartKey.has(partKey)) partByPartKey.set(partKey, { fseiban, fhincd });
  }
  if (partByPartKey.size === 0) return {};

  const statusByLookupKey = await findMaterialArrivalStatusByPart([...partByPartKey.values()]);
  const result: Record<string, MaterialArrivalStatus> = {};
  for (const [partKey, part] of partByPartKey) {
    const status = statusByLookupKey.get(materialArrivalLookupKey(part.fseiban, part.fhincd));
    if (status != null) result[partKey] = status;
  }
  return result;
}
