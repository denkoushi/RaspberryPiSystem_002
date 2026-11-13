import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useSetKioskProductionScheduleRowCompletion } from '../../../api/hooks';
import { productionScheduleQueryKeys } from '../../../api/queryKeys/productionSchedule';
import { reportSessakuPieceError } from '../errorTelemetry';

import { usePlanningBoardOffline } from './offline/PlanningBoardOfflineProvider';
import { planningBoardChainCompletedKey } from './usePlanningBoardChainItems';

import type { CompletionOverlay, FeedbackKind } from './planningBoardPageModel';
import type { PlanningBoardStatus } from './types';
import type { KioskGrindingPlanningBoardProgressiveResult } from '../../../api/hooks/production-schedule/grinding-planning-board';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardItem, SessakuPieceCompletionRequest, SessakuPiecesMutationResponse } from '@raspi-system/shared-types';
import type { RefObject } from 'react';

type Options = {
  data: KioskGrindingPlanningBoardProgressiveResult['data'];
  boardQuery: Pick<KioskGrindingPlanningBoardProgressiveResult, 'isPlaceholderData' | 'refetch'>;
  category: GrindingPlanningBoardCategory;
  interactionLocked: boolean;
  bulkReady: boolean;
  writePending: boolean;
  queuedItems: readonly GrindingPlanningBoardItem[];
  applyArrival: (item: GrindingPlanningBoardItem) => GrindingPlanningBoardItem;
  status: PlanningBoardStatus;
  piecePending?: boolean;
  piecePendingRef: RefObject<boolean>;
  piecePendingParentRef?: RefObject<string | null>;
  currentItemsRef: RefObject<GrindingPlanningBoardItem[]>;
  completePiece: (payload: SessakuPieceCompletionRequest & { pieceId: string }) => Promise<SessakuPiecesMutationResponse>;
  completePieceOp?: (payload: SessakuPieceCompletionRequest & { pieceId: string; opNo: number }) => Promise<SessakuPiecesMutationResponse>;
  notify: (message: string, kind: FeedbackKind) => void;
  onCompleted: (item: GrindingPlanningBoardItem, opNo?: number) => void;
  onIncomplete: () => void;
};

export function usePlanningBoardCompletion({ data, boardQuery, category, queuedItems, applyArrival, status, interactionLocked, bulkReady, writePending,
  piecePending = false, piecePendingRef, piecePendingParentRef, currentItemsRef, completePiece, completePieceOp, notify, onCompleted, onIncomplete }: Options) {
  const { gate, snapshot, enabled } = usePlanningBoardOffline();
  const latestDataRef = useRef(data);
  useLayoutEffect(() => { latestDataRef.current = data; }, [data]);
  useLayoutEffect(() => { if (enabled && snapshot.phase === 'online') { setCompletionOverlay(new Map()); setCompletionPendingParentIds(new Set()); setCompletionPendingItemIds(new Set()); } }, [enabled, snapshot.phase]);
  const queryClient = useQueryClient();
  const { refetch } = boardQuery;
  const { mutateAsync: setCompletionAsync } = useSetKioskProductionScheduleRowCompletion();
  const [completionOverlay, setCompletionOverlay] = useState<ReadonlyMap<string, CompletionOverlay>>(new Map());
  const completionOverlayRef = useRef(completionOverlay);
  completionOverlayRef.current = completionOverlay;
  const writePendingRef = useRef(writePending);
  writePendingRef.current = writePending;
  const bulkReadyRef = useRef(bulkReady);
  bulkReadyRef.current = bulkReady;
  const completionPendingRef = useRef(new Set<string>());
  const pendingPieceParentsRef = useRef(new Set<string>());
  const [completionPendingParentIds, setCompletionPendingParentIds] = useState<ReadonlySet<string>>(new Set());
  const [completionPendingItemIds, setCompletionPendingItemIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!data || boardQuery.isPlaceholderData) return;
    setCompletionOverlay((current) => {
      const next = new Map(current);
      // A GET acknowledges or replaces a whole parent's piece set. Never retain
      // revisions once that set is current, even if only the parent CSV changed.
      let pieceParents: Map<string, { overlay: CompletionOverlay; ids: Set<string> }> | undefined;
      for (const [id, overlay] of current) {
        if (overlay.item.kind !== 'piece' || !overlay.item.parentItemId || overlay.siteKey !== data.siteKey) continue;
        const parentId = overlay.item.parentItemId;
        const group = (pieceParents ??= new Map()).get(parentId);
        if (group) { group.overlay = overlay; group.ids.add(id); }
        else pieceParents.set(parentId, { overlay, ids: new Set([id]) });
      }
      if (pieceParents) {
        const piecesByParent = new Map<string, { version: number; ids: Set<string> }>();
        for (const item of data.items) {
          if (item.kind !== 'piece' || !item.parentItemId || !pieceParents.has(item.parentItemId)) continue;
          const group = piecesByParent.get(item.parentItemId);
          if (group) { group.version = Math.max(group.version, item.pieceSetVersion ?? 0); group.ids.add(item.itemId); }
          else piecesByParent.set(item.parentItemId, { version: item.pieceSetVersion ?? 0, ids: new Set([item.itemId]) });
        }
        for (const [parentId, { overlay, ids }] of pieceParents) {
          if (pendingPieceParentsRef.current.has(parentId)) continue;
          const pieces = piecesByParent.get(parentId);
          const replaced = pieces != null && pieces.version >= (overlay.item.pieceSetVersion ?? 0);
          const disappeared = overlay.snapshotId !== data.snapshotId &&
            (!pieces || [...ids].some((id) => !pieces.ids.has(id)));
          if (replaced || disappeared) for (const id of ids) next.delete(id);
        }
      }
      for (const item of data.items) {
        if (item.kind === 'piece') continue;
        const overlay = next.get(item.itemId);
        if (!overlay || overlay.siteKey !== data.siteKey || overlay.snapshotId === data.snapshotId ||
          completionPendingItemIds.has(item.itemId)) continue;
        if (item.completionSource === 'import' || (item.isCompleted === overlay.isCompleted &&
          (item.completionSource ?? null) === overlay.completionSource)) next.delete(item.itemId);
        // One disagreeing refresh after the save may have started before it; a second one is the truth
        // (e.g. another kiosk changed the row again).
        else if (overlay.saved && overlay.staleSnapshotId && overlay.staleSnapshotId !== data.snapshotId) next.delete(item.itemId);
        else if (overlay.saved && !overlay.staleSnapshotId) next.set(item.itemId, { ...overlay, staleSnapshotId: data.snapshotId });
      }
      return next.size === current.size && [...next].every(([key, value]) => current.get(key) === value) ? current : next;
    });
  }, [data, boardQuery.isPlaceholderData, completionPendingItemIds]);
  const toggleCompletion = useCallback(async (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete', opNo?: number) => {
    if (!gate.attempt()) return;
    const data = latestDataRef.current;
    const generation = gate.generation();
    const currentItem = currentItemsRef.current.find((candidate) => candidate.itemId === item.itemId) ?? item;
    if (opNo != null && (currentItem.kind !== 'piece' || !completePieceOp || !currentItem.ops?.some((op) => op.opNo === opNo))) return;
    const parentId = currentItem.kind === 'piece' ? currentItem.parentItemId : undefined;
    if (interactionLocked || (piecePendingRef.current && currentItem.itemId === piecePendingParentRef?.current) || (currentItem.kind === 'piece' && (!bulkReadyRef.current || piecePendingRef.current || writePendingRef.current ||
      !currentItem.pieceId || currentItem.pieceSetVersion == null || !parentId)) || !data || currentItem.completionSource === 'import' ||
      completionPendingRef.current.has(item.itemId) || (parentId && pendingPieceParentsRef.current.has(parentId))) return;
    const previousOverlay = completionOverlayRef.current.get(item.itemId);
    if (parentId) {
      pendingPieceParentsRef.current.add(parentId);
      setCompletionPendingParentIds(new Set(pendingPieceParentsRef.current));
    }
    completionPendingRef.current.add(item.itemId);
    setCompletionPendingItemIds(new Set(completionPendingRef.current));
    let completedOpNos = currentItem.completedOpNos;
    if (currentItem.ops?.length) {
      if (opNo == null) completedOpNos = intent === 'complete' ? currentItem.ops.map((op) => op.opNo) : [];
      else completedOpNos = intent === 'complete' ? [...new Set([...(completedOpNos ?? []), opNo])]
        : (completedOpNos ?? []).filter((value) => value !== opNo);
    }
    const optimisticCompleted = opNo == null ? intent === 'complete' : currentItem.ops!.every((op) => completedOpNos!.includes(op.opNo));
    setCompletionOverlay((current) => new Map(current).set(item.itemId, {
      isCompleted: optimisticCompleted, completionSource: optimisticCompleted ? 'manual' : null,
      item: { ...currentItem, ...(currentItem.ops?.length ? { completedOpNos } : {}) }, siteKey: data.siteKey,
      category: data.resourceCategories?.[item.originalResourceCd ?? ''] ?? category,
      snapshotId: data.snapshotId
    }));
    try {
      let savedItem = currentItem;
      if (currentItem.kind === 'piece' && currentItem.pieceId && currentItem.pieceSetVersion != null) {
        const payload = { pieceId: currentItem.pieceId, intent,
          ...(currentItem.itemId.startsWith('pieceops:') ? { itemId: currentItem.itemId } : {}),
          expectedPieceSetVersion: currentItem.pieceSetVersion, itemRevision: currentItem.itemRevision };
        const response = await gate.run(() => opNo != null && completePieceOp ? completePieceOp({ ...payload, opNo }) : completePiece(payload));
        savedItem = response.pieces.find((candidate) => candidate.itemId === item.itemId) ?? currentItem;
        const savedPieces = new Map(response.pieces.map((piece) => [piece.itemId, piece]));
        currentItemsRef.current = currentItemsRef.current.map((candidate) => savedPieces.get(candidate.itemId) ?? candidate);
        setCompletionOverlay((current) => {
          const next = new Map(current);
          for (const piece of response.pieces) {
            next.set(piece.itemId, {
              item: piece, isCompleted: piece.isCompleted, completionSource: piece.completionSource,
              siteKey: data.siteKey, category: data.resourceCategories?.[piece.originalResourceCd ?? ''] ?? category,
              snapshotId: data.snapshotId, saved: true
            });
          }
          return next;
        });
      } else await gate.run(() => setCompletionAsync({ rowId: currentItem.sourceRowId, intent }));
      setCompletionOverlay((current) => {
        const overlay = current.get(item.itemId);
        return overlay ? new Map(current).set(item.itemId, { ...overlay, item: savedItem, saved: true }) : current;
      });
      if (item.kind === 'piece' || enabled) {
        void queryClient.invalidateQueries({ queryKey: planningBoardChainCompletedKey });
        await refetch({ loadAlreadyInvalidated: true }).catch(() => undefined);
      }
      else void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
      if (generation !== gate.generation()) return;
      if (opNo == null ? intent === 'complete' : savedItem.isCompleted) onCompleted(savedItem, opNo);
      else if (intent === 'incomplete') onIncomplete();
    } catch (error) {
      if (generation !== gate.generation()) return;
      if (currentItem.kind === 'piece') reportSessakuPieceError(intent === 'complete' ? 'complete' : 'uncomplete', currentItem, error);
      setCompletionOverlay((current) => {
        const next = new Map(current);
        if (opNo != null && previousOverlay) next.set(item.itemId, previousOverlay);
        else next.delete(item.itemId);
        return next;
      });
      const status = isAxiosError(error) ? error.response?.status : undefined;
      notify(item.kind === 'piece' && status === 409
        ? '表示中のデータが更新されています。最新状態を取得してください。'
        : '完了状態を保存できませんでした。時間をおいて再試行してください。', 'error');
      if (item.kind === 'piece' && (status === 409 || status === 403)) await refetch();
    } finally {
      if (generation !== gate.generation()) { completionPendingRef.current.delete(item.itemId); if (parentId) pendingPieceParentsRef.current.delete(parentId); }
      else {
      if (parentId) {
        pendingPieceParentsRef.current.delete(parentId);
        setCompletionPendingParentIds(new Set(pendingPieceParentsRef.current));
      }
      completionPendingRef.current.delete(item.itemId);
      setCompletionPendingItemIds(new Set(completionPendingRef.current));
      }
    }
  }, [interactionLocked, category, setCompletionAsync, completePiece, completePieceOp, queryClient, notify, onCompleted, onIncomplete, refetch, currentItemsRef, piecePendingRef, piecePendingParentRef, gate, enabled]);
  const clearPieceCompletion = useCallback((parentItemId: string) => {
    setCompletionOverlay((current) => new Map([...current].filter(([, overlay]) =>
      overlay.item.itemId !== parentItemId && (overlay.item.kind !== 'piece' || overlay.item.parentItemId !== parentItemId))));
  }, []);
  const { displayItems, pieces } = useMemo(() => {
    const items = [...queuedItems];
    const itemIds = new Set(items.map((item) => item.itemId));
    // Keep the row available for instant undo even after the filtered GET omits it.
    for (const [itemId, overlay] of completionOverlay) {
      if (overlay.item.kind !== 'piece' && !itemIds.has(itemId) && overlay.siteKey === data?.siteKey &&
        (category === 'all' || overlay.category === category)) items.push(overlay.item);
    }
    let pieces: GrindingPlanningBoardItem[] | undefined;
    const displayItems = items.map(applyArrival).map((item) => {
      if (item.kind === 'piece') (pieces ??= []).push(item);
      const overlay = completionOverlay.get(item.itemId);
      if (!overlay || overlay.siteKey !== data?.siteKey) return item;
      const savedPiece = item.kind === 'piece' && overlay.saved;
      if (savedPiece && (item.pieceSetVersion ?? 0) >= (overlay.item.pieceSetVersion ?? 0)) return item;
      if (item.completionSource === 'import' && !(savedPiece && (item.pieceSetVersion ?? 0) < (overlay.item.pieceSetVersion ?? 0))) return item;
      return { ...item, ...(item.kind === 'piece' && overlay.item.ops?.length ? { completedOpNos: overlay.item.completedOpNos } : {}), ...(savedPiece ? { itemRevision: overlay.item.itemRevision, pieceSetVersion: overlay.item.pieceSetVersion } : {}), isCompleted: overlay.isCompleted, completionSource: overlay.completionSource };
    }).filter((item) => boardQuery.isPlaceholderData || status === 'all' || (status === 'incomplete' && item.quantityWarning) || item.isCompleted === (status === 'complete'));
    return { displayItems, pieces };
  }, [queuedItems, completionOverlay, applyArrival, data?.siteKey, category, status, boardQuery.isPlaceholderData]);
  const disabledCompletionItemIds = useMemo(() => {
    let disabledIds: Set<string> | undefined;
    if (piecePending && piecePendingParentRef?.current) disabledIds = new Set([...completionPendingItemIds, piecePendingParentRef.current]);
    if (!pieces) return disabledIds ?? completionPendingItemIds;
    for (const item of pieces) {
      if (writePending || (piecePending && item.parentItemId === piecePendingParentRef?.current) || !bulkReady || !item.pieceId || item.pieceSetVersion == null || !item.parentItemId || (item.parentItemId && completionPendingParentIds.has(item.parentItemId))) {
        (disabledIds ??= new Set(completionPendingItemIds)).add(item.itemId);
      }
    }
    return disabledIds ?? completionPendingItemIds;
  }, [pieces, writePending, piecePending, piecePendingParentRef, bulkReady, completionPendingParentIds, completionPendingItemIds]);
  return { displayItems, completionOverlay, completionPendingRef, completionPendingParentIds, completionPendingItemIds: disabledCompletionItemIds, toggleCompletion, clearPieceCompletion };
}
