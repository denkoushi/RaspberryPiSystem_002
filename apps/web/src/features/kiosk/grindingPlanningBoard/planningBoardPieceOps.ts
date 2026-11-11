import type { GrindingPlanningBoardItem, SessakuPieceOpMergeRequest, SessakuPieceOpSplitRequest, SessakuPiecesMutationResponse } from '@raspi-system/shared-types';

// While an op split/merge refreshes, show the returned pieces in place of the parent's old bars.
export function withPieceOpResult<T extends GrindingPlanningBoardItem>(items: T[], pending: boolean, result: SessakuPiecesMutationResponse | null) {
  if (!pending || !result) return items;
  const { parentItemId, pieces, pieceSetVersion } = result;
  return [...items.filter((item) => item.itemId !== parentItemId && item.parentItemId !== parentItemId), ...pieces.map((piece) => ({ ...piece, pieceSetVersion }))];
}

export async function runPieceOpMutation(params: {
  item: GrindingPlanningBoardItem; fromOpNo?: number; previousItems: readonly GrindingPlanningBoardItem[];
  run: (fn: () => Promise<SessakuPiecesMutationResponse>) => Promise<SessakuPiecesMutationResponse>;
  opSplit: (payload: SessakuPieceOpSplitRequest) => Promise<SessakuPiecesMutationResponse>;
  opMerge: (payload: SessakuPieceOpMergeRequest) => Promise<SessakuPiecesMutationResponse>;
}) {
  const { item, fromOpNo, previousItems } = params;
  const payload = { itemId: item.itemId, expectedPieceSetVersion: item.pieceSetVersion!, itemRevision: item.itemRevision };
  const response = await params.run(() => fromOpNo == null ? params.opMerge(payload) : params.opSplit({ ...payload, fromOpNo }));
  const intervals = previousItems.filter((candidate) => candidate.pieceId === item.pieceId).sort((a, b) => (a.opRange?.fromOpNo ?? 0) - (b.opRange?.fromOpNo ?? 0));
  const previous = intervals[intervals.findIndex((candidate) => candidate.itemId === item.itemId) - 1];
  return {
    response: { ...response, parentItemId: item.parentItemId! },
    affectedItemIds: response.affectedItemIds ?? [],
    target: { itemId: fromOpNo == null ? previous?.itemId ?? `piece:${item.pieceId}` : `pieceops:${item.pieceId}:${fromOpNo}`, parentItemId: item.parentItemId! }
  };
}
