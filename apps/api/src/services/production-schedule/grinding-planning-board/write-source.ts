import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertWritablePlanningItemIds } from '../missing-standard-hours-process.js';
import { encodeSessakuPieceKey, sessakuPieceIdFromItemId, resolveSessakuPieceItemKeys } from '../sessaku-pieces/piece-key.js';
import { asRowData, buildGrindingPlanningBoardLogicalKey, decodeRowItemId, logicalKeyFseiban } from './shared.js';
import { readWinnerRowsByLogicalKeyFseibans } from './source.js';

export async function discoverSourceRows(itemIds: readonly string[]): Promise<Map<string, string>> {
  assertWritablePlanningItemIds(itemIds);
  const logicalKeyByItem = new Map<string, string>();
  const pieceItemIds = itemIds.filter((itemId) => sessakuPieceIdFromItemId(itemId));
  // One lookup for every piece item; on any failure fall back to the per-item loop so errors keep their order.
  const pieceKeys = pieceItemIds.length > 1
    ? await resolveSessakuPieceItemKeys(prisma, pieceItemIds).catch(() => null)
    : null;
  for (const itemId of itemIds) {
    const pieceKey = sessakuPieceIdFromItemId(itemId)
      ? pieceKeys?.get(itemId) ?? (await resolveSessakuPieceItemKeys(prisma, [itemId])).get(itemId)
      : null;
    const logicalKey = pieceKey ? encodeSessakuPieceKey(pieceKey) : decodeRowItemId(itemId);
    if (logicalKey == null) throw new ApiError(400, '対象アイテムIDが不正です', undefined, 'INVALID_ITEM_ID');
    logicalKeyByItem.set(itemId, logicalKey);
  }
  // The logical key starts with the raw FSEIBAN, so saves read only the edited seibans instead of every winner row.
  const rows = await readWinnerRowsByLogicalKeyFseibans(prisma, [...logicalKeyByItem.values()].map(logicalKeyFseiban));
  const byLogicalKey = new Map(rows.map((row) => [buildGrindingPlanningBoardLogicalKey(asRowData(row.rowData)), row.id]));
  // 4要素のキー(保存済みの古いID、切削の分割の親)は、同じ4列に見える行がちょうど1つのときだけ解決する。
  // 番号が2つ以上あるときは、どちらの注文か決められないので解決しない。
  const byLegacyKey = new Map<string, string[]>();
  for (const row of rows) {
    const legacyKey = JSON.stringify((JSON.parse(buildGrindingPlanningBoardLogicalKey(asRowData(row.rowData))) as string[]).slice(0, 4));
    byLegacyKey.set(legacyKey, [...(byLegacyKey.get(legacyKey) ?? []), row.id]);
  }
  const sourceByItem = new Map<string, string>();
  for (const itemId of itemIds) {
    const logicalKey = logicalKeyByItem.get(itemId) ?? '';
    const legacyIds = byLegacyKey.get(logicalKey);
    const sourceRowId = byLogicalKey.get(logicalKey) ?? (legacyIds?.length === 1 ? legacyIds[0] : undefined);
    if (sourceRowId) sourceByItem.set(itemId, sourceRowId);
  }
  if (sourceByItem.size !== new Set(itemIds).size) throw new ApiError(409, '対象アイテムが消滅または更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  return sourceByItem;
}
