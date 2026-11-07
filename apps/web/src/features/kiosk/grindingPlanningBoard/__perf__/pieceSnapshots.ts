import { perfPieceId } from './fixture';

import type { GrindingPlanningBoardItem, SessakuPieceCompletionRequest, SessakuPiecesMergeRequest, SessakuPiecesMutationResponse, SessakuPiecesSplitRequest } from '@raspi-system/shared-types';

type Board = { items: GrindingPlanningBoardItem[]; boardVersion: number; snapshotId: string };
type Operation = 'split' | 'merge' | 'completion';
type Payload = SessakuPiecesSplitRequest | SessakuPiecesMergeRequest | (SessakuPieceCompletionRequest & { pieceId: string });

/** Immediate mutation response and a separate GET snapshot, shared by both runners. */
export function pieceSnapshot<T extends Board>(board: T, operation: Operation, payload: Payload): { snapshot: T; response: SessakuPiecesMutationResponse } {
  const split = payload as SessakuPiecesSplitRequest;
  const merge = payload as SessakuPiecesMergeRequest;
  const completion = payload as SessakuPieceCompletionRequest & { pieceId: string };
  const target = board.items.find(item => operation === 'completion' ? item.pieceId === completion.pieceId
    : operation === 'split' ? split.targetPieceId ? item.pieceId === split.targetPieceId : item.itemId === split.parentItemId
    : item.pieceId === merge.pieceIds[0]);
  if (!target) throw new Error(`Missing ${operation} target`);
  const parentItemId = target.parentItemId ?? target.itemId;
  const siblings = board.items.filter(item => item.parentItemId === parentItemId || item.itemId === parentItemId);
  const pieceSetVersion = (target.pieceSetVersion ?? 0) + 1;
  const generation = board.boardVersion + 1;
  const unitMinutes = target.requiredMinutes! / target.plannedQuantity!;
  const makePiece = (quantity: number, index: number): GrindingPlanningBoardItem => {
    const pieceId = perfPieceId(100_000 + generation * 100 + index);
    return { ...target, itemId: `piece:${pieceId}`, kind: 'piece', pieceId, parentItemId,
      quantity, plannedQuantity: quantity, parentPlannedQuantity: target.parentPlannedQuantity ?? target.plannedQuantity,
      requiredMinutes: unitMinutes * quantity, isCompleted: false, manualIsCompleted: false, completionSource: null };
  };
  let pieces: GrindingPlanningBoardItem[];
  if (operation === 'split') pieces = siblings.flatMap(item => item === target ? split.quantities.map(makePiece) : [item]);
  else if (operation === 'merge') {
    const selected = siblings.filter(item => merge.pieceIds.includes(item.pieceId!));
    pieces = siblings.filter(item => !selected.includes(item));
    if (pieces.length) pieces.push(makePiece(selected.reduce((sum, item) => sum + item.quantity!, 0), 0));
  } else pieces = siblings.map(item => item === target ? { ...item, isCompleted: completion.intent === 'complete',
    manualIsCompleted: completion.intent === 'complete', completionSource: completion.intent === 'complete' ? 'manual' : null } : item);
  pieces = pieces.map((item, index) => ({ ...item, piecePosition: index + 1, pieceSetVersion,
    itemRevision: `piece-saved-${generation}-${index}`, version: item.version + 1 }));
  const parent: GrindingPlanningBoardItem = { ...target, itemId: parentItemId, kind: 'row',
    plannedQuantity: target.parentPlannedQuantity!, requiredMinutes: unitMinutes * target.parentPlannedQuantity! };
  for (const key of ['parentItemId', 'pieceId', 'piecePosition', 'pieceSetVersion', 'quantity', 'parentPlannedQuantity'] as const) delete parent[key];
  const first = board.items.indexOf(siblings[0]!);
  const items = board.items.flatMap((item, index) => index === first ? pieces.length ? pieces : [parent] : siblings.includes(item) ? [] : [item]);
  const snapshot = { ...board, items, boardVersion: generation, snapshotId: `piece-snapshot-${generation}` };
  return { snapshot, response: { parentItemId, pieceSetVersion, quantityWarning: null, pieces,
    parentIsCompleted: pieces.length > 0 && pieces.every(item => item.isCompleted), sourceRowId: target.sourceRowId } };
}
