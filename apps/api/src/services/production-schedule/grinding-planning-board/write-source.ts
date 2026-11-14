import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertWritablePlanningItemIds } from '../missing-standard-hours-process.js';
import { encodeSessakuPieceKey, sessakuPieceIdFromItemId, resolveSessakuPieceItemKeys } from '../sessaku-pieces/piece-key.js';
import { asRowData, buildGrindingPlanningBoardLogicalKey, decodeRowItemId, logicalKeyFseiban } from './shared.js';
import { readWinnerRowsByLogicalKeyFseibans } from './source.js';

export async function discoverSourceRows(itemIds: readonly string[]): Promise<Map<string, string>> {
  assertWritablePlanningItemIds(itemIds);
  const logicalKeyByItem = new Map<string, string>();
  for (const itemId of itemIds) {
    const pieceKey = sessakuPieceIdFromItemId(itemId) ? (await resolveSessakuPieceItemKeys(prisma, [itemId])).get(itemId) : null;
    const logicalKey = pieceKey ? encodeSessakuPieceKey(pieceKey) : decodeRowItemId(itemId);
    if (logicalKey == null) throw new ApiError(400, '対象アイテムIDが不正です', undefined, 'INVALID_ITEM_ID');
    logicalKeyByItem.set(itemId, logicalKey);
  }
  // The logical key starts with the raw FSEIBAN, so saves read only the edited seibans instead of every winner row.
  const rows = await readWinnerRowsByLogicalKeyFseibans(prisma, [...logicalKeyByItem.values()].map(logicalKeyFseiban));
  const byLogicalKey = new Map(rows.map((row) => [buildGrindingPlanningBoardLogicalKey(asRowData(row.rowData)), row.id]));
  const sourceByItem = new Map<string, string>();
  for (const itemId of itemIds) {
    const sourceRowId = byLogicalKey.get(logicalKeyByItem.get(itemId) ?? '');
    if (sourceRowId) sourceByItem.set(itemId, sourceRowId);
  }
  if (sourceByItem.size !== new Set(itemIds).size) throw new ApiError(409, '対象アイテムが消滅または更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  return sourceByItem;
}
