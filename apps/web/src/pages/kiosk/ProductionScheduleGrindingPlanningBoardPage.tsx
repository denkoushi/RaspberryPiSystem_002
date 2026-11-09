import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useKioskSessakuPieceMutations,
  useKioskProductionScheduleResources,
  useKioskGrindingPlanningBoardProgressive,
  useKioskGrindingPlanningBoardProcessChips,
  useKioskGrindingPlanningBoardLoad,
  useKioskGrindingPlanningBoardSeibanCandidates,
  useKioskGrindingPlanningBoardDueDetail,
  useUpdateKioskGrindingPlanningBoardOverrides,
  useUpdateKioskGrindingPlanningBoardPins,
  useUpdateKioskGrindingPlanningBoardDueScope,
  useUpdateKioskGrindingPlanningBoardRank,
  useUpdateKioskGrindingPlanningBoardResourceOrder,
  useUpdateKioskGrindingPlanningBoardResourceOrderBulk,
  useUpdateKioskGrindingPlanningBoardSeibanOrder,
  useUpdateKioskGrindingPlanningBoardSeibanChecks
} from '../../api/hooks';
import { productionScheduleQueryKeys } from '../../api/queryKeys/productionSchedule';
import { reportSessakuPieceError } from '../../features/kiosk/errorTelemetry';
import { createPlanningBoardSeibanActions } from '../../features/kiosk/grindingPlanningBoard/createPlanningBoardSeibanActions';
import { PlanningBoardBulkEditDialog } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardBulkEditDialog';
import { PlanningBoardDuePanels } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardDuePanels';
import { EMPTY_ITEMS, EMPTY_ORDER, todayJst, addUtcDays, displayedDue, defaultDueDateFor, applyOptimisticOverride } from '../../features/kiosk/grindingPlanningBoard/planningBoardPageModel';
import { PlanningBoardPageView } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardPageView';
import { PieceOperationBlockedError, PlanningBoardPiecesContext, usePlanningBoardPieceActions, usePlanningBoardPieceFocus } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardPiecePopover';
import { buildPlanningBoardPlacementByPart, buildPlanningBoardProcessChipsByPart, collectPlanningBoardProcessChipParts } from '../../features/kiosk/grindingPlanningBoard/planningBoardProcessChipData';
import { PlanningBoardPlacementContext, PlanningBoardProcessChipsContext } from '../../features/kiosk/grindingPlanningBoard/planningBoardProcessChips';
import { PlanningBoardSeibanDrawer } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardSeibanDrawer';
import { PlanningBoardToolbar } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardToolbar';
import {
  resolveGrindingPlanningBoardResource,
  sortGrindingPlanningBoardItems
} from '../../features/kiosk/grindingPlanningBoard/sortGrindingPlanningBoardItems';
import { usePersistedPlanningBoardScawMode } from '../../features/kiosk/grindingPlanningBoard/usePersistedPlanningBoardScawMode';
import { usePlanningBoardArrival } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardArrival';
import { usePlanningBoardCategory } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardCategory';
import { usePlanningBoardCompletion } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardCompletion';
import { usePlanningBoardDueActions } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardDueActions';
import { usePlanningBoardLargeScreen } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardLargeScreen';
import { usePlanningBoardNotices } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardNotices';
import { usePlanningBoardPageGantt } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardPageGantt';
import { usePlanningBoardPageItems } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardPageItems';
import { usePlanningBoardQueryData } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardQueryData';
import { usePlanningBoardWriteQueue } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue';
import { isVisibleByArrival } from '../../features/kiosk/isVisibleByArrival';
import { DScheduleMinutesProvider } from '../../features/kiosk/productionSchedule/DScheduleMinutesContext';
import { useUnsavedChangesGuard } from '../../features/navigation/useUnsavedChangesGuard';
import { useSingleFlight } from '../../hooks/useSingleFlight';

import type { OrderPreview, ResourceOrderSnapshot, ResourceOrderHistory, DueMode, ResourceChoice, FeedbackKind, DuePickerState, PendingDueScopeUpdate } from '../../features/kiosk/grindingPlanningBoard/planningBoardPageModel';
import type { PlanningBoardAllocation, PlanningBoardStatus } from '../../features/kiosk/grindingPlanningBoard/types';
import type { PlanningBoardDisplayItem } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue';
import type {
  GrindingPlanningBoardItem, GrindingPlanningBoardOverrideItemRequest,
  GrindingPlanningBoardResourceOrderPlacement, GrindingPlanningBoardDueRequest, GrindingPlanningBoardSpecialDueKind
} from '@raspi-system/shared-types';

export function ProductionScheduleGrindingPlanningBoardPage() {
  const { category, changeCategory } = usePlanningBoardCategory();
  const [pinMode, setPinMode] = useState(false);
  const [orderPreview, setOrderPreview] = useState<OrderPreview | null>(null);
  const [focusedSeiban, setFocusedSeiban] = useState<string | null>(null);
  const [scanFocusKey, setScanFocusKey] = useState(0);
  const currentItemsRef = useRef<GrindingPlanningBoardItem[]>([]);
  const { completionNotice, setCompletionNotice, scanNotice, setScanNotice } = usePlanningBoardNotices();
  useEffect(() => {
    if (!focusedSeiban) return;
    // document runs before Dialog's window Escape handler; preserve focus only for the piece popup.
    const clear = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[data-planning-board-piece-dialog], [data-planning-board-popover], [data-forward-queue], [data-planning-board-value-sheet]')) setFocusedSeiban(null); };
    document.addEventListener('keydown', clear);
    return () => document.removeEventListener('keydown', clear);
  }, [focusedSeiban]);
  const [colorBySeiban, setColorBySeiban] = useState(true);
  const { largeScreen, changeLargeScreen } = usePlanningBoardLargeScreen();
  const [ganttEnabled, setGanttEnabled] = useState(true);
  const [view, setView] = useState<'seiban' | 'resource'>('resource');
  const [status, setStatus] = useState<PlanningBoardStatus>('incomplete');
  const [allocation, setAllocation] = useState<PlanningBoardAllocation>('alternate');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [focusedFseiban, setFocusedFseiban] = useState<string | null>(null);
  const [openFseibans, setOpenFseibans] = useState<ReadonlySet<string>>(new Set());
  const [showCompletedCandidates, setShowCompletedCandidates] = useState(false);
  const [selectedItemIdsByCategory, setSelectedItemIdsByCategory] = useState<Record<string, ReadonlySet<string>>>({});
  const [openInitialized, setOpenInitialized] = useState(false);
  const dueDetailIdentityRef = useRef<string | null>(null);
  const [editorSnapshot, setEditorSnapshot] = useState<{
    items: GrindingPlanningBoardItem[];
    sourceRevision: string;
    resources: string[];
  } | null>(null);
  const { run: runEditor, pending: editorPending } = useSingleFlight();
  const [editorOpen, setEditorOpen] = useState(false);
  const editorGenerationRef = useRef(0);
  const [resourceChoice, setResourceChoice] = useState<ResourceChoice>('unchanged');
  const [dueMode, setDueMode] = useState<DueMode>('none');
  const [dueDate, setDueDate] = useState(() => addUtcDays(todayJst(), 3));
  const [offsetDays, setOffsetDays] = useState('1');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorConflict, setEditorConflict] = useState(false);
  const [orderConflict, setOrderConflict] = useState(false);
  const [orderRegistrationError, setOrderRegistrationError] = useState<string | null>(null);
  const [rankConflict, setRankConflict] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('success');
  const [specialDueMode, setSpecialDueMode] = useState<GrindingPlanningBoardSpecialDueKind | null>(null);
  const [resourceOrderHistory, setResourceOrderHistory] = useState<ResourceOrderHistory[]>([]);
  const resourceOrderHistoryId = useRef(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dueDetailFseiban, setDueDetailFseiban] = useState<string | null>(null);
  const [dueDetailTargetFseiban, setDueDetailTargetFseiban] = useState<string | null>(null);
  const [duePickerState, setDuePickerState] = useState<DuePickerState | null>(null);
  const [dueConflict, setDueConflict] = useState(false);
  const [dueError, setDueError] = useState<string | null>(null);
  const [pendingDueScope, setPendingDueScope] = useState<PendingDueScopeUpdate | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedbackRevisionRef = useRef(0);
  const registeredServerFseibansRef = useRef<Set<string> | null>(null);
  const boardSiteKeyRef = useRef<string | null>(null);

  const { scawEnabled, toggleScawMode } = usePersistedPlanningBoardScawMode();
  const dueSource: 'excel' | 'scaw' = scawEnabled ? 'scaw' : 'excel';
  const queryClient = useQueryClient();
  const pieceMutations = useKioskSessakuPieceMutations();
  const [piecePhase, setPiecePhase] = useState<'idle' | 'saving' | 'refreshing'>('idle'); const piecePending = piecePhase !== 'idle'; const piecePendingRef = useRef(false); const piecePendingParentRef = useRef<string | null>(null);
  const boardQuery = useKioskGrindingPlanningBoardProgressive(
    { category, view, completionFilter: status, dueSource, includePieces: true },
    { refetchIntervalMs: editorOpen || orderPreview || piecePending ? false : undefined }
  );
  const loadQuery = useKioskGrindingPlanningBoardLoad(category);
  const candidateQuery = useKioskGrindingPlanningBoardSeibanCandidates({
    category,
    completionFilter: showCompletedCandidates ? 'all' : 'incomplete'
  }, { enabled: drawerOpen });
  const resourcesQuery = useKioskProductionScheduleResources({ pauseRefetch: true });
  const dueDetailQuery = useKioskGrindingPlanningBoardDueDetail(dueDetailFseiban);
  const { mutateAsync: updatePinsAsync } = useUpdateKioskGrindingPlanningBoardPins({ invalidateOnSuccess: false });
  const { mutateAsync: updateOverridesAsync } = useUpdateKioskGrindingPlanningBoardOverrides({ invalidateOnSuccess: false });
  const updateDueScope = useUpdateKioskGrindingPlanningBoardDueScope({ invalidateOnSuccess: false });
  const { mutateAsync: updateRankAsync } = useUpdateKioskGrindingPlanningBoardRank({ invalidateOnSuccess: false });
  const { mutateAsync: updateResourceOrderAsync } = useUpdateKioskGrindingPlanningBoardResourceOrder({ invalidateOnSuccess: false });
  const { mutateAsync: updateResourceOrderBulkAsync } = useUpdateKioskGrindingPlanningBoardResourceOrderBulk({ invalidateOnSuccess: false });
  const updateOrder = useUpdateKioskGrindingPlanningBoardSeibanOrder({ invalidateOnSuccess: false });
  const updateChecks = useUpdateKioskGrindingPlanningBoardSeibanChecks({ invalidateOnSuccess: false });

  const notify = useCallback((message: string, kind: FeedbackKind) => {
    feedbackRevisionRef.current += 1;
    if (feedbackTimerRef.current != null) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    const revision = feedbackRevisionRef.current;
    setFeedback(message);
    setFeedbackKind(kind);
    if (kind === 'success') {
      feedbackTimerRef.current = setTimeout(() => {
        if (feedbackRevisionRef.current !== revision) return;
        feedbackTimerRef.current = null;
        setFeedback(null);
      }, 2500);
    }
  }, []);

  const clearFeedback = useCallback(() => {
    feedbackRevisionRef.current += 1;
    if (feedbackTimerRef.current != null) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
    setFeedback(null);
  }, []);

  useEffect(() => () => {
    if (feedbackTimerRef.current != null) clearTimeout(feedbackTimerRef.current);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const handleError = useCallback((error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 409) {
      setRankConflict(true);
      notify('表示中のデータが更新されています。最新状態を取得してください。', 'error');
      return;
    }
    notify('保存できませんでした。時間をおいて再試行してください。', 'error');
  }, [notify]);

  const data = usePlanningBoardQueryData(boardQuery.data);
  const { arrivalFilterEnabled, toggleArrivalFilter, applyArrival, changeArrival, changeFirstProcessArrival, arrivalPending, arrivalError } = usePlanningBoardArrival(data, nowMs);
  const scopeReady = boardQuery.scopeReady;
  const bulkReady = scopeReady && boardQuery.isComplete;
  const interactionLocked = !scopeReady || Boolean(orderPreview);
  const sourceRevision = data?.sourceRevision ?? '';
  const rankScopeKey = `${data?.siteKey ?? ''}\0${category}\0${status}`;
  const rankMutationReady = Boolean(
    data &&
    data.category === category &&
    data.view === view &&
    boardQuery.hasStableData &&
    !boardQuery.isLoading &&
    !boardQuery.isError &&
    !boardQuery.isPlaceholderData
  );
  const writeQueue = usePlanningBoardWriteQueue({
    scope: `${rankScopeKey}:${allocation}`,
    items: data?.items ?? EMPTY_ITEMS,
    order: data?.registeredFseibans ?? EMPTY_ORDER,
    uncheckedFseibans: data?.uncheckedFseibans ?? data?.excelNonMachineFseibans ?? EMPTY_ORDER,
    sourceRevision,
    refresh: async () => {
      const [result] = await Promise.all([
        boardQuery.refetch(),
        queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardLoadAll }, { cancelRefetch: false })
      ]);
      await queryClient.invalidateQueries({
        queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll,
        refetchType: 'none'
      });
      if (dueDetailIdentityRef.current) await dueDetailQuery.refetch();
      return result;
    },
    onStart: (label) => notify(`${label}を保存中…`, 'processing'),
    onSuccess: (label) => notify(label === '納期順' ? '納期の早い順に並べ直しました' : label === '順番を戻す' ? '1つ前の順番に戻しました' : `${label}を保存しました。`, 'success'),
    onError: handleError
  });
  const { enqueue: enqueueWrite, items: queuedItems, order: registeredFseibans, hasPendingSeiban, acceptRefreshedState } = writeQueue;
  const activeFseibans = useMemo(() => new Set(registeredFseibans.filter((fseiban) => !writeQueue.uncheckedFseibans.includes(fseiban))), [registeredFseibans, writeQueue.uncheckedFseibans]);
  const onCompleted = useCallback((item: GrindingPlanningBoardItem) => {
    setSelectedItemIdsByCategory((current) => Object.fromEntries(Object.entries(current).map(([key, ids]) => {
      const next = new Set(ids); next.delete(item.itemId); return [key, next];
    })));
    setCompletionNotice({ item });
  }, [setCompletionNotice]);
  const onIncomplete = useCallback(() => setCompletionNotice(null), [setCompletionNotice]);
  const { displayItems, completionPendingRef, completionPendingParentIds, completionPendingItemIds, toggleCompletion, clearPieceCompletion } = usePlanningBoardCompletion({
    data, boardQuery, category, queuedItems, applyArrival, status, interactionLocked, bulkReady, writePending: writeQueue.pending, piecePending, piecePendingRef, piecePendingParentRef, currentItemsRef,
    completePiece: pieceMutations.completion.mutateAsync, notify, onCompleted, onIncomplete
  });

  const arrivalItems = useMemo(() => displayItems.filter((item) => isVisibleByArrival(item, arrivalFilterEnabled)), [displayItems, arrivalFilterEnabled]);

  const ganttItems = useMemo(() => displayItems.filter((item) => view === 'seiban' && focusedFseiban ? item.fseiban === focusedFseiban : activeFseibans.has(item.fseiban)), [displayItems, view, focusedFseiban, activeFseibans]);

  const chipParts = useMemo(() => collectPlanningBoardProcessChipParts(arrivalItems), [arrivalItems]);
  const chipsQuery = useKioskGrindingPlanningBoardProcessChips(chipParts);
  const chipData = usePlanningBoardQueryData(chipsQuery.data);
  const chipsByPart = useMemo(() => buildPlanningBoardProcessChipsByPart(arrivalItems, chipsQuery.isError ? undefined : chipData?.chipsByPartKey), [arrivalItems, chipsQuery.isError, chipData]);
  const placementByPart = useMemo(() => buildPlanningBoardPlacementByPart(arrivalItems), [arrivalItems]);

  const refreshRequired = orderConflict || rankConflict || (writeQueue.blocked && !writeQueue.pending);
  const tableWriteBlocked = writeQueue.blocked || rankConflict || orderConflict || Boolean(orderPreview); const piecesWriting = piecePending || completionPendingParentIds.size > 0; const writeBlocked = tableWriteBlocked || piecesWriting;
  const rankDisabled = useCallback((item: GrindingPlanningBoardItem) => !rankMutationReady || tableWriteBlocked || hasPendingSeiban(item.fseiban, true),
  [rankMutationReady, tableWriteBlocked, hasPendingSeiban]);
  useUnsavedChangesGuard(writeQueue.pending || Boolean(orderPreview));

  const baseDueDetail = allocation === 'original'
    ? dueDetailQuery.data?.original
    : dueDetailQuery.data?.alternate;
  const dueDetail = useMemo(() => {
    if (!baseDueDetail || allocation === 'original' || !pendingDueScope || pendingDueScope.fseiban !== dueDetailFseiban) return baseDueDetail;
    if (pendingDueScope.scope.kind === 'seiban') {
      return { ...baseDueDetail, dueDate: pendingDueScope.dueDate };
    }
    const processingType = pendingDueScope.scope.processingType;
    return {
      ...baseDueDetail,
      processingTypeDueDates: (baseDueDetail.processingTypeDueDates ?? []).map((entry) => (
        entry.processingType === processingType
          ? { ...entry, dueDate: pendingDueScope.dueDate }
          : entry
      ))
    };
  }, [allocation, baseDueDetail, dueDetailFseiban, pendingDueScope]);

  useEffect(() => {
    if (!pendingDueScope || !dueDetailQuery.data) return;
    const currentDetail = dueDetailQuery.data.alternate;
    if (currentDetail.fseiban !== pendingDueScope.fseiban) return;
    if (pendingDueScope.responseScopeRevision != null && dueDetailQuery.data.scopeRevision !== pendingDueScope.baseScopeRevision) {
      setPendingDueScope(null);
    }
  }, [dueDetailQuery.data, pendingDueScope]);

  useEffect(() => {
    if (!data || boardQuery.isPlaceholderData) return;
    const siteChanged = boardSiteKeyRef.current != null && boardSiteKeyRef.current !== data.siteKey;
    const previous = registeredServerFseibansRef.current;
    boardSiteKeyRef.current = data.siteKey;
    if (!openInitialized || siteChanged) {
      setOpenFseibans(new Set(data.seibanOrder.length ? data.seibanOrder : data.registeredFseibans));
      setOpenInitialized(true);
    }
    if (!writeQueue.pending) {
      const added = data.registeredFseibans.filter((value) => previous != null && !previous.has(value));
      if (added.length) {
        setOpenFseibans((current) => new Set([...current, ...added]));
      }
      registeredServerFseibansRef.current = new Set(data.registeredFseibans);
    }
  }, [boardQuery.isPlaceholderData, data, openInitialized, writeQueue.pending]);

  useEffect(() => {
    const registered = new Set(registeredFseibans);
    const prune = (current: ReadonlySet<string>) => [...current].every((value) => registered.has(value))
      ? current : new Set([...current].filter((value) => registered.has(value)));
    const keepRegistered = (current: string | null) => current && registered.has(current) ? current : null;
    setDueDetailTargetFseiban(keepRegistered); setDueDetailFseiban(keepRegistered); setOpenFseibans(prune);
  }, [registeredFseibans]);

  const { itemsBySeiban, sortedItemsBySeiban, machineNames, visibleItems, specialDueCounts, selectedItemIds, selectedVisibleItems } = usePlanningBoardPageItems({
    displayItems: arrivalItems, registeredFseibans, view, allocation, data, activeFseibans, selectedItemIdsByCategory, category
  });
  const editorItems = editorSnapshot?.items ?? [];
  const resourceDragDisabled = tableWriteBlocked;
  currentItemsRef.current = displayItems;
  const pieceRefreshRef = useRef<typeof boardQuery.refetch | null>(null); const [pieceFocusRevision, setPieceFocusRevision] = useState(0);
  const pieceFocusItemIdRef = usePlanningBoardPieceFocus(displayItems, piecePending, !boardQuery.isError && !boardQuery.isFetching && boardQuery.isComplete, pieceFocusRevision);
  const onPieceRemoved = useCallback((item: GrindingPlanningBoardItem) => {
    if (piecePendingRef.current) return; pieceFocusItemIdRef.current = { itemId: item.itemId, parentItemId: item.parentItemId ?? item.itemId }; setPieceFocusRevision((current) => current + 1);
  }, [pieceFocusItemIdRef]);
  const specialDueModeRef = useRef(specialDueMode); specialDueModeRef.current = specialDueMode;

  const toggleItem = useCallback((item: GrindingPlanningBoardItem, selected: boolean) => {
    if (!scopeReady || item.isCompleted) return;
    setSelectedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      if (selected) next.add(item.itemId); else next.delete(item.itemId);
      return { ...current, [category]: next };
    });
  }, [category, scopeReady]);
  const refetchBoard = boardQuery.refetch;
  const splitPieces = pieceMutations.split.mutateAsync; const mergePieces = pieceMutations.merge.mutateAsync;
  const changePieces = useCallback(async (items: GrindingPlanningBoardItem[], quantities?: number[]) => {
    if (!bulkReady || refreshRequired || Boolean(orderPreview) || piecePendingRef.current || interactionLocked || writeBlocked || writeQueue.pending || completionPendingRef.current.size) {
      throw new PieceOperationBlockedError(refreshRequired
        ? '表示中のデータが更新されています。最新状態を取得してください。' : '保存中…', refreshRequired);
    }
    piecePendingParentRef.current = items[0]?.parentItemId ?? items[0]?.itemId ?? null; piecePendingRef.current = true; setPiecePhase('saving');
    try {
      let target: { itemId: string; parentItemId: string }; let affectedItemIds: string[] = []; const item = items[0]; if (!item) throw new Error('Missing piece item'); const previousItems = currentItemsRef.current; const previousIds = new Set(previousItems.map((candidate) => candidate.itemId));
      if (quantities) {
        const response = await splitPieces({ parentItemId: item.parentItemId ?? item.itemId,
          ...(item.kind === 'piece' ? { targetPieceId: item.pieceId } : {}), quantities,
          expectedPieceSetVersion: item.pieceSetVersion ?? 0, itemRevision: item.itemRevision });
        affectedItemIds = response.affectedItemIds ?? []; target = { itemId: response.pieces.find((piece) => !piece.isCompleted && !previousIds.has(piece.itemId))?.itemId ?? item.itemId, parentItemId: item.parentItemId ?? item.itemId };
      } else if (item.parentItemId && item.pieceSetVersion != null) {
        const pieceIds: string[] = [];
        for (const piece of items) {
          if (!piece.pieceId) throw new Error('Missing piece ID');
          pieceIds.push(piece.pieceId);
        }
        const response = await mergePieces({ parentItemId: item.parentItemId, pieceIds,
          expectedPieceSetVersion: item.pieceSetVersion, itemRevisions: Object.fromEntries(items.map((piece) => [piece.itemId, piece.itemRevision])) });
        affectedItemIds = response.affectedItemIds ?? []; target = { itemId: response.pieces.find((piece) => !piece.isCompleted && !previousIds.has(piece.itemId))?.itemId ?? item.parentItemId, parentItemId: item.parentItemId };
      } else throw new Error('Missing piece set');
      // Saving owns the whole transition, even if a GET has already removed the popup.
      clearPieceCompletion(target.parentItemId); setCompletionNotice((current) => current && (current.item.itemId === target.parentItemId || current.item.parentItemId === target.parentItemId) ? null : current);
      const affectedIds = new Set([...affectedItemIds, target.parentItemId, ...items.map((piece) => piece.itemId), ...previousItems.concat(currentItemsRef.current).filter((piece) => piece.parentItemId === target.parentItemId).map((piece) => piece.itemId)]);
      setSelectedItemIdsByCategory((current) => Object.fromEntries(Object.entries(current).map(([key, ids]) => [key, new Set([...ids].filter((id) => !affectedIds.has(id)))])));
      pieceFocusItemIdRef.current = target; pieceRefreshRef.current = refetchBoard; setPiecePhase('refreshing');
    } catch (error) { if (items[0]) reportSessakuPieceError(quantities ? 'split' : 'merge', items[0], error);
      const conflict = isAxiosError(error) && (error.response?.status === 409 || (error.response?.status === 400 && error.response.data?.errorCode === 'PIECE_QUANTITY_CONFLICT')); const message = conflict ? '表示中のデータが更新されています。最新状態を取得してください。' : '保存できませんでした。時間をおいて再試行してください。';
      pieceFocusItemIdRef.current = null; piecePendingRef.current = false; setPiecePhase('idle'); notify(message, 'error'); void refetchBoard().catch(() => undefined);
      throw new Error(message);
    }
  }, [interactionLocked, writeBlocked, writeQueue.pending, completionPendingRef, notify, splitPieces, mergePieces, refetchBoard, pieceFocusItemIdRef, bulkReady, refreshRequired, orderPreview, clearPieceCompletion, setCompletionNotice]);
  useEffect(() => {
    if (piecePhase !== 'refreshing') return; const refresh = pieceRefreshRef.current; pieceRefreshRef.current = null; if (!refresh) return;
    // Run after the save's popup close has committed. Keep every piece gate until settle.
    void refresh({ loadAlreadyInvalidated: true }).catch(() => ({ isError: true })).then((result) => {
      if (result.isError) pieceFocusItemIdRef.current = null; piecePendingRef.current = false; setPiecePhase('idle');
    });
  }, [piecePhase, pieceFocusItemIdRef]);
  const toggleAll = useCallback((items: readonly GrindingPlanningBoardItem[], selected: boolean) => {
    if (!bulkReady) return;
    setSelectedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      for (const item of items) {
        if (item.isCompleted) continue;
        if (selected) next.add(item.itemId); else next.delete(item.itemId);
      }
      return { ...current, [category]: next };
    });
  }, [bulkReady, category]);

  const canMoveResource = useCallback((item: GrindingPlanningBoardItem, target: string) => {
    const originalCategory = data?.resourceCategories?.[item.originalResourceCd ?? ''];
    const targetCategory = data?.resourceCategories?.[target];
    return originalCategory && targetCategory ? originalCategory === targetCategory : category !== 'all';
  }, [category, data?.resourceCategories]);

  const enqueueOverrides = useCallback((
    originals: readonly GrindingPlanningBoardItem[], requests: GrindingPlanningBoardOverrideItemRequest[],
    label: string, onFailed?: (error: unknown) => void, capturedSourceRevision?: string, orderAction?: { onSaved: () => void }, onSaved?: () => void
  ) => {
    if (writeBlocked || originals.some((item) => hasPendingSeiban(item.fseiban, true))) return false;
    if (requests.some((request) => {
      if (request.resourceCd === undefined) return false;
      const item = originals.find((candidate) => candidate.itemId === request.itemId);
      return !item || !canMoveResource(item, request.resourceCd ?? item.originalResourceCd ?? '');
    })) return false;
    const patches = new Map(requests.map((request) => [request.itemId, request]));
    return enqueueWrite({
      label, itemIds: originals.map((item) => item.itemId), seibans: [...new Set(originals.map((item) => item.fseiban))],
      order: Boolean(orderAction), onSaved: onSaved ?? orderAction?.onSaved,
      apply: (display) => ({ ...display, items: display.items.map((item) => {
        const request = patches.get(item.itemId);
        return request ? applyOptimisticOverride(item, request) : item;
      }) }),
      save: async (context) => updateOverridesAsync({ sourceRevision: capturedSourceRevision ?? context.sourceRevision,
        items: requests.map((request) => {
          const original = originals.find((candidate) => candidate.itemId === request.itemId);
          if (!original) throw new Error('Missing planning board item');
          const item = context.item(original);
          return { ...request, itemRevision: item.itemRevision, overrideVersion: item.version };
        }) }),
      onFailed
    });
  }, [enqueueWrite, updateOverridesAsync, writeBlocked, hasPendingSeiban, canMoveResource]);

  const updateSpecialDue = useCallback((original: GrindingPlanningBoardItem) => {
    const item = currentItemsRef.current.find((candidate) => candidate.itemId === original.itemId) ?? original;
    const mode = specialDueModeRef.current;
    if (!scopeReady || !rankMutationReady || allocation === 'original' || !mode || item.isCompleted || hasPendingSeiban(item.fseiban)) return;
    const preview = item as PlanningBoardDisplayItem;
    const kind = preview.pendingSpecialDue !== undefined ? preview.pendingSpecialDue : item.specialDue?.kind;
    const next = kind === mode ? null : mode;
    enqueueOverrides([item], [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, specialDue: next }],
      next === null ? '特別納期の解除' : next === 'today' ? '今日中' : '朝まで');
  }, [allocation, enqueueOverrides, hasPendingSeiban, rankMutationReady, scopeReady]);

  const openEditor = useCallback((items: readonly GrindingPlanningBoardItem[]) => {
    if (!scopeReady || writeBlocked || items.some((item) => hasPendingSeiban(item.fseiban, true))) return;
    const target = items.filter((item) => !item.isCompleted);
    if (target.length === 0) return;
    if (!data) return;
    editorGenerationRef.current += 1;
    setEditorSnapshot({
      items: [...target],
      sourceRevision: data.sourceRevision,
      resources: data.resources.filter((resource) => target.every((item) => canMoveResource(item, resource)))
    });
    setResourceChoice('unchanged');
    setDueMode('none');
    setDueDate(defaultDueDateFor(target, allocation));
    setOffsetDays('1');
    clearFeedback();
    setEditorError(null);
    setEditorConflict(false);
    setEditorOpen(true);
  }, [allocation, clearFeedback, data, scopeReady, writeBlocked, hasPendingSeiban, canMoveResource]);

  const { openDueDetail, closeDueDetail, openDuePicker, refreshDueDetail, commitDueDate } = usePlanningBoardDueActions({
    dueDetailIdentityRef, setDueDetailTargetFseiban, setDueDetailFseiban, setDuePickerState,
    setDueConflict, setDueError, dueDetailQuery, dueDetailFseiban, allocation, dueConflict,
    hasPendingSeiban, pendingDueScope, notify, boardQuery, setRankConflict, acceptRefreshedState,
    duePickerState, writeBlocked, enqueueWrite, updateDueScope, setPendingDueScope
  });

  const applyEditor = () => runEditor(async () => {
    if (!editorSnapshot || allocation === 'original' || editorItems.length === 0) return;
    const offset = Number(offsetDays);
    if (dueMode === 'offsetDays' && (!Number.isInteger(offset) || offset < 1)) {
      setEditorError('加算日数は1以上の整数で入力してください。');
      return;
    }
    const due: GrindingPlanningBoardDueRequest | undefined = dueMode === 'date'
      ? { kind: 'date', date: dueDate }
      : dueMode === 'offsetDays'
        ? { kind: 'offsetDays', days: offset }
        : dueMode === 'restore' ? { kind: 'restore' } : undefined;
    const items = editorItems.map((item) => ({
      itemId: item.itemId,
      itemRevision: item.itemRevision,
      overrideVersion: item.version,
      ...(resourceChoice !== 'unchanged' ? { resourceCd: resourceChoice === 'restore' ? null : resourceChoice } : {}),
      ...(due ? { due } : {})
    }));
    if (items.every((item) => !('resourceCd' in item) && !('due' in item))) return;
    if (resourceChoice !== 'unchanged' && resourceChoice !== 'restore' && editorItems.some((item) => !canMoveResource(item, resourceChoice))) {
      setEditorError('研削と切削の間では資源CDを変更できません。');
      return;
    }
    const editorGeneration = editorGenerationRef.current;
    const saved = await new Promise<boolean>((resolve) => {
      const accepted = enqueueOverrides(editorItems, items, `${items.length}件の変更`, (error) => {
        resolve(false);
        if (editorGenerationRef.current !== editorGeneration) return;
        const conflict = isAxiosError(error) && error.response?.status === 409;
        setEditorConflict(conflict);
        setEditorError(conflict ? '表示中のデータが更新されています。最新状態を取得してから対象を選び直してください。' : '保存できませんでした。入力内容と通信状態を確認してください。');
        setEditorOpen(true);
      }, editorSnapshot.sourceRevision, undefined, () => resolve(true));
      if (!accepted) resolve(false);
    });
    if (saved && editorGenerationRef.current === editorGeneration) setEditorOpen(false);
  });

  const moveResourceByDrag = useCallback((item: GrindingPlanningBoardItem, targetResource: string) => {
    if (!data || !scopeReady || !rankMutationReady || allocation === 'original' || item.isCompleted ||
      !data.resources.includes(targetResource) || !canMoveResource(item, targetResource) || resolveGrindingPlanningBoardResource(item, allocation) === targetResource) return;
    enqueueOverrides([item], [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, resourceCd: targetResource }], '資源CD');
  }, [allocation, data, enqueueOverrides, rankMutationReady, scopeReady, canMoveResource]);

  const moveDueByDrag = useCallback((original: GrindingPlanningBoardItem, date: string) => {
    const item = currentItemsRef.current.find((candidate) => candidate.itemId === original.itemId);
    if (!item || !data || !scopeReady || !rankMutationReady || writeBlocked || allocation !== 'alternate' || item.isCompleted) return;
    const before = displayedDue(item, allocation);
    if (!before || date === before || (date < before && date < todayJst())) return;
    enqueueOverrides([item], [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version,
      due: { kind: 'date', date } }], '納期');
  }, [allocation, data, enqueueOverrides, rankMutationReady, scopeReady, writeBlocked]);

  const historyScope = `${data?.siteKey ?? ''}:${category}:${arrivalFilterEnabled}`;
  const rememberResourceOrder = useCallback((id: number, snapshot: ResourceOrderSnapshot) => {
    setResourceOrderHistory((history) => {
      const previous = history.find((entry) => entry.id === id);
      return previous ? history.map((entry) => entry === previous ? { ...entry, orders: [...entry.orders, snapshot] } : entry)
        : [...history, { id, scope: historyScope, orders: [snapshot] }].slice(-10);
    });
  }, [historyScope]);
  const snapshotResourceOrder = useCallback((resource: string): ResourceOrderSnapshot => ({ resourceCd: resource,
    itemIds: sortGrindingPlanningBoardItems(currentItemsRef.current.filter((candidate) => !candidate.isCompleted &&
      (resolveGrindingPlanningBoardResource(candidate, 'alternate') ?? '未設定') === resource), registeredFseibans, 'resource', 'alternate').map((candidate) => candidate.itemId)
  }), [registeredFseibans]);

  const reorderResourceByDrag = useCallback((item: GrindingPlanningBoardItem, targetItem: GrindingPlanningBoardItem,
    placement: GrindingPlanningBoardResourceOrderPlacement) => {
    const resource = resolveGrindingPlanningBoardResource(item, allocation);
    if (!data || !scopeReady || !rankMutationReady || writeBlocked || allocation === 'original' || item.isCompleted || targetItem.isCompleted ||
      !resource || resource !== resolveGrindingPlanningBoardResource(targetItem, allocation) ||
      (item.specialDue?.expiresAt ?? null) !== (targetItem.specialDue?.expiresAt ?? null) ||
      hasPendingSeiban(item.fseiban, true) || hasPendingSeiban(targetItem.fseiban, true)) return;
    const affected = currentItemsRef.current.filter((candidate) => resolveGrindingPlanningBoardResource(candidate, allocation) === resource);
    const before = snapshotResourceOrder(resource);
    const proposed = before.itemIds.filter((id) => id !== item.itemId);
    proposed.splice(proposed.indexOf(targetItem.itemId) + (placement === 'after' ? 1 : 0), 0, item.itemId);
    if (proposed.every((id, index) => id === before.itemIds[index])) return;
    const historyId = ++resourceOrderHistoryId.current;
    enqueueWrite({ label: '資源CD内の順序', itemIds: affected.map((candidate) => candidate.itemId),
      seibans: [...new Set(affected.map((candidate) => candidate.fseiban))], order: true,
      onSaved: () => { if (ganttEnabled) rememberResourceOrder(historyId, before); },
      apply: (display) => {
        const source = display.items.find((candidate) => candidate.itemId === item.itemId);
        const target = display.items.find((candidate) => candidate.itemId === targetItem.itemId);
        if (!source || !target) return display;
        const ordered = sortGrindingPlanningBoardItems(display.items.filter((candidate) =>
          resolveGrindingPlanningBoardResource(candidate, allocation) === resolveGrindingPlanningBoardResource(source, allocation) &&
          (candidate.specialDue?.expiresAt ?? null) === (source.specialDue?.expiresAt ?? null)), display.order, 'resource', 'alternate');
        const from = ordered.findIndex((candidate) => candidate.itemId === source.itemId);
        if (from < 0 || !ordered.some((candidate) => candidate.itemId === target.itemId)) return display;
        const [moved] = ordered.splice(from, 1);
        ordered.splice(ordered.findIndex((candidate) => candidate.itemId === target.itemId) + (placement === 'after' ? 1 : 0), 0, moved);
        const ranks = new Map(ordered.map((candidate, index) => [candidate.itemId, index + 1]));
        return { ...display, items: display.items.map((candidate) => {
          const rank = ranks.get(candidate.itemId);
          return rank != null ? { ...candidate, alternateRank: rank } : candidate;
        }) };
      },
      save: async (context) => {
        const source = context.item(item); const target = context.item(targetItem);
        const response = await updateResourceOrderAsync({ sourceRevision: context.sourceRevision, itemId: source.itemId,
          itemRevision: source.itemRevision, overrideVersion: source.version, targetItemId: target.itemId,
          targetItemRevision: target.itemRevision, targetOverrideVersion: target.version, placement });
        return { ...response, items: response.items.map((ranked) => ({ ...context.item(affected.find((candidate) => candidate.itemId === ranked.itemId) ?? ranked),
          alternateRank: ranked.alternateRank, itemRevision: ranked.itemRevision, version: ranked.version })) };
      }
    });
  }, [allocation, data, enqueueWrite, rankMutationReady, scopeReady, updateResourceOrderAsync, writeBlocked, hasPendingSeiban, ganttEnabled, rememberResourceOrder, snapshotResourceOrder]);

  const refreshAfterConflict = async () => {
    setEditorError('最新状態を取得しています…');
    try {
      const result = await boardQuery.refetch();
      if (result.isError) {
        setEditorError('最新状態を取得できませんでした。再試行してください。');
        return;
      }
      setEditorSnapshot(null);
      setEditorOpen(false);
      setEditorConflict(false);
      setRankConflict(false);
      acceptRefreshedState();
      notify('最新状態を取得しました。対象を選び直して再適用してください。', 'success');
    } catch {
      setEditorError('最新状態を取得できませんでした。再試行してください。');
    }
  };

  const changeRank = useCallback((item: GrindingPlanningBoardItem, rank: number | null) => {
    if (!data || !rankMutationReady || allocation === 'original' || item.isCompleted || writeBlocked || hasPendingSeiban(item.fseiban, true)) return;
    enqueueWrite({ label: '個別順位', itemIds: [item.itemId], seibans: [item.fseiban],
      apply: (display) => ({ ...display, items: display.items.map((candidate) => candidate.itemId === item.itemId ? { ...candidate, alternateRank: rank } : candidate) }),
      save: async (context) => {
        const current = context.item(item);
        const result = await updateRankAsync({ sourceRevision: context.sourceRevision, itemId: current.itemId,
          itemRevision: current.itemRevision, overrideVersion: current.version, alternateRank: rank });
        return { sourceRevision: result.sourceRevision, items: [{ ...current, alternateRank: result.alternateRank,
          itemRevision: result.itemRevision, version: result.overrideVersion }] };
      }
    });
  }, [allocation, data, enqueueWrite, rankMutationReady, updateRankAsync, writeBlocked, hasPendingSeiban]);

  const persistChecks = (uncheckedFseibans: string[]) => {
    if (!data || interactionLocked || writeBlocked) return;
    enqueueWrite({ label: '製番チェック', itemIds: [], seibans: [], order: true,
      apply: (display) => ({ ...display, uncheckedFseibans }),
      save: (context) => updateChecks.mutateAsync({ sourceRevision: context.sourceRevision, uncheckedFseibans }),
      onFailed: (error) => setOrderConflict(isAxiosError(error) && error.response?.status === 409)
    });
  };

  const { refreshAfterOrderConflict, addSeibans, addSeiban, moveSeiban } = createPlanningBoardSeibanActions({
    data, scopeReady, writeBlocked, allocation, setOrderRegistrationError, enqueueWrite,
    registeredFseibans, updateOrder, setOrderConflict, notify, boardQuery, setRankConflict,
    acceptRefreshedState, setOpenFseibans
  });

  const {
    focusItems, gantt, orderActionsDisabled, ganttLayout, lastResourceOrder, handleOrderScan,
    moveResourceInGantt, sortResourceOrdersByDue, proposeResourceOrder, applyResourceOrder, togglePin, undoResourceOrder
  } = usePlanningBoardPageGantt({
    focusedFseiban, sortedItemsBySeiban, view, visibleItems, ganttItems, arrivalFilterEnabled, nowMs, ganttEnabled, allocation, category,
    data, registeredFseibans, bulkReady, rankMutationReady, writeBlocked, writeQueue, orderPreview,
    resourceOrderHistory, historyScope, currentItemsRef, hasPendingSeiban, enqueueWrite, updateResourceOrderBulkAsync,
    setColorBySeiban, setFocusedFseiban, setOpenFseibans, setFocusedSeiban, setScanFocusKey, setScanNotice,
    scopeReady, pinMode, canMoveResource, snapshotResourceOrder, notify, resourceOrderHistoryId, enqueueOverrides,
    setResourceOrderHistory, rememberResourceOrder, setPinMode, setOrderPreview, sourceRevision, rankConflict, orderConflict, updatePinsAsync
  });
  const openEditorForItem = useCallback((item: GrindingPlanningBoardItem) => openEditor([item]), [openEditor]);
  const returnFromFocus = useCallback(() => setFocusedFseiban(null), []);
  const toggleFocusAll = useCallback((selected: boolean) => toggleAll(focusItems, selected), [focusItems, toggleAll]);
  const paneActionsBySeiban = useMemo(() => {
    const actions = new Map<string, {
      onToggleOpen: () => void;
      onFocus: () => void;
      onToggleAll: (selected: boolean) => void;
    }>();
    for (const [fseiban, group] of itemsBySeiban) {
      actions.set(fseiban, {
        onToggleOpen: () => setOpenFseibans((current) => {
          const next = new Set(current);
          if (next.has(fseiban)) next.delete(fseiban); else next.add(fseiban);
          return next;
        }),
        onFocus: () => setFocusedFseiban(fseiban),
        onToggleAll: (selected) => toggleAll(group, selected)
      });
    }
    return actions;
  }, [itemsBySeiban, toggleAll]);
  const pieceActions = usePlanningBoardPieceActions({
    createEnabled: data?.pieceCapabilities?.createEnabled === true,
    enabled: data?.pieceCapabilities?.includePieces === true,
    resourceCategories: data?.resourceCategories, selectedItems: selectedVisibleItems, changePieces, completionPendingParentIds, onRemoved: onPieceRemoved,
    ready: bulkReady && !writeQueue.blocked && !rankConflict && !orderConflict && !orderPreview, blocked: writeBlocked || writeQueue.pending || completionPendingRef.current.size > 0,
    blockedMessage: refreshRequired ? '表示中のデータが更新されています。最新状態を取得してください。' : '保存中…', blockedIsError: refreshRequired
  });
  const toolbarSelectedItems = focusedFseiban
    ? selectedVisibleItems.filter((item) => item.fseiban === focusedFseiban)
    : selectedVisibleItems;
  return (
    <DScheduleMinutesProvider dueSource={dueSource}><PlanningBoardProcessChipsContext.Provider value={chipsByPart}>
    <PlanningBoardPlacementContext.Provider value={placementByPart}>
    <PlanningBoardPiecesContext.Provider value={pieceActions}>
    <main className="relative min-h-0 w-full shrink-0 overflow-hidden bg-slate-950 px-2 py-2 text-white sm:px-3">
      <PlanningBoardToolbar arrivalFilterEnabled={arrivalFilterEnabled} onToggleArrivalFilter={toggleArrivalFilter} scawEnabled={scawEnabled} onToggleScawMode={toggleScawMode}
        largeScreen={largeScreen} onToggleLargeScreen={() => changeLargeScreen(!largeScreen)}
        colorBySeiban={colorBySeiban} onToggleColorBySeiban={() => setColorBySeiban((enabled) => !enabled)}
        onOrderScan={handleOrderScan} focusedSeiban={focusedSeiban} onClearSeibanFocus={() => setFocusedSeiban(null)}
        ganttEnabled={ganttEnabled}
        singleResourceCd={gantt.singleResourceCd} singleResourceLanes={gantt.singleResourceLanes}
        singleResourceNameMap={resourcesQuery.data?.resourceNameMap ?? {}}
        singleResourcePickerAnchor={gantt.singleResourcePickerAnchor} onOpenSingleResourcePicker={gantt.openSingleResourcePicker}
        onCloseSingleResourcePicker={gantt.closeSingleResourcePicker}
        onSingleResourceChange={(resource) => { if (resource) setView('resource'); gantt.changeSingleResource(resource); }}
        onToggleGantt={() => { setFocusedSeiban(null); setPinMode(false); setGanttEnabled((enabled) => !enabled); }}
        ganttScale={gantt.scale} onGanttScaleChange={gantt.changeScale}
        ganttMode={gantt.mode} onGanttModeChange={(mode) => { setPinMode(false); gantt.changeMode(mode); }}
        lateCount={gantt.singleResourceCd ? ganttLayout.groups.filter((group) => group.resource === gantt.singleResourceCd).flatMap((group) => group.rows.flatMap((row) => row.bars)).filter((bar) => bar.tone === 'late').length : ganttLayout.lateCount} onNextLate={gantt.scrollToNextLate}
        pinMode={pinMode} onTogglePinMode={() => setPinMode((value) => !value)}
        orderPreview={orderPreview} previewPending={writeQueue.pending || writeQueue.blocked || rankConflict || orderConflict}
        onApplyOrder={applyResourceOrder} onCancelOrder={() => setOrderPreview(null)}
        onProposeOrder={proposeResourceOrder} onSortDue={sortResourceOrdersByDue} onUndoOrder={undoResourceOrder}
        orderDisabled={orderActionsDisabled} canUndoOrder={Boolean(lastResourceOrder)} overlapCount={ganttLayout.overlapCount} onNextOverlap={gantt.scrollToNextOverlap}
        category={category} view={view}
        status={status} allocation={allocation}
        selectedCount={toolbarSelectedItems.length}
        scopeDisabled={writeQueue.pending || Boolean(orderPreview)}
        bulkDisabled={allocation === 'original' || toolbarSelectedItems.length === 0 || !bulkReady || writeBlocked}
        registeredCount={registeredFseibans.length}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCategoryChange={(value) => { if (!writeQueue.pending) changeCategory(value); }}
        onViewChange={(next) => { setPinMode(false); if (next !== 'resource') gantt.changeSingleResource(null); setView(next); }}
        onStatusChange={(value) => { if (!writeQueue.pending) setStatus(value); }}
        onAllocationChange={(value) => { if (!writeQueue.pending) setAllocation(value); }}
        onOpenDueEditor={() => openEditor(toolbarSelectedItems)}
        specialDueMode={view === 'resource' ? specialDueMode : null}
        onSpecialDueModeChange={view === 'resource' ? setSpecialDueMode : undefined}
        specialDueDisabled={allocation === 'original' || interactionLocked || resourceDragDisabled}
        feedback={feedback || refreshRequired ? (
          <div className={`flex h-full min-w-0 items-center gap-1 rounded-md px-2 text-xs ${
            !feedback || feedbackKind === 'error' ? 'bg-rose-950/70 text-rose-100'
              : feedbackKind === 'processing' ? 'bg-sky-950/60 text-sky-100'
                : 'bg-emerald-950/60 text-emerald-100'
          }`} role="status">
            <span className="min-w-0 flex-1 truncate">{feedback ?? '表示中のデータが更新されています。最新状態を取得してください。'}</span>
            {refreshRequired ? (
              <button type="button" className="h-11 w-11 shrink-0 rounded text-lg text-emerald-100" onClick={() => void refreshAfterOrderConflict()} aria-label="最新状態を取得">↻</button>
            ) : null}
            {feedback ? <button type="button" className="h-11 w-11 shrink-0 text-slate-300" onClick={clearFeedback} aria-label="通知を閉じる">✕</button> : null}
          </div>
        ) : boardQuery.appendError ? (
          <div className="flex h-full items-center px-2 text-xs text-rose-200" role="alert"><span className="truncate">一覧の追加取得に失敗しました。再読み込みしてください。</span></div>
        ) : boardQuery.isLoading || !scopeReady || boardQuery.isAppending ? (
          <div className="flex h-full items-center px-2 text-xs text-slate-400" role="status"><span className="truncate">{boardQuery.isLoading || !scopeReady ? '一覧を読み込み中…' : '一覧を追加取得中…'}</span></div>
        ) : null}
        specialDueCounts={specialDueCounts}
      />
      {completionNotice && <div role="status" className="fixed bottom-4 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-3 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-bold text-emerald-50 shadow-lg">
        <span>完了にしました</span>
        <button type="button" className="min-h-7 rounded border border-emerald-300 px-2 disabled:opacity-60" disabled={interactionLocked || piecesWriting || completionPendingItemIds.has(completionNotice.item.itemId)}
          onClick={() => { void toggleCompletion(completionNotice.item, 'incomplete'); setCompletionNotice(null); }}>↶ 戻す</button>
      </div>}
      {scanNotice && <p role="status" className="pointer-events-none fixed left-1/2 top-16 z-[90] -translate-x-1/2 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-bold text-emerald-50 shadow-lg">{scanNotice.text}</p>}
      {boardQuery.isError ? <p className={`${data ? 'absolute z-50 ' : ''}p-5 text-sm text-rose-200`}>一覧を読み込めませんでした。</p> : null}
      <PlanningBoardPageView
        data={data} ganttEnabled={ganttEnabled} focusedSeiban={focusedSeiban} setFocusedSeiban={setFocusedSeiban}
        colorBySeiban={colorBySeiban} registeredFseibans={registeredFseibans} gantt={gantt} ganttLayout={ganttLayout}
        view={view} orderPreview={orderPreview} category={category} resourcesQuery={resourcesQuery}
        pinMode={pinMode} togglePin={togglePin} selectedItemIds={selectedItemIds} toggleItem={toggleItem}
        toggleCompletion={toggleCompletion} completionPendingItemIds={completionPendingItemIds} onArrivalChange={changeArrival} onFirstProcessArrivalChange={changeFirstProcessArrival} arrivalPending={arrivalPending} arrivalError={arrivalError}
        moveDueByDrag={moveDueByDrag} reorderResourceByDrag={reorderResourceByDrag} moveResourceInGantt={moveResourceInGantt}
        canMoveResource={canMoveResource} interactionLocked={interactionLocked} writeQueue={writeQueue}
        allocation={allocation} writeBlocked={writeBlocked} piecesWriting={piecesWriting} rankMutationReady={rankMutationReady}
        focusedFseiban={focusedFseiban} focusItems={focusItems} machineNames={machineNames}
        returnFromFocus={returnFromFocus} toggleFocusAll={toggleFocusAll} openEditorForItem={openEditorForItem}
        changeRank={changeRank} rankDisabled={rankDisabled} bulkReady={bulkReady} activeFseibans={activeFseibans}
        itemsBySeiban={itemsBySeiban} paneActionsBySeiban={paneActionsBySeiban} sortedItemsBySeiban={sortedItemsBySeiban}
        openFseibans={openFseibans} scanFocusKey={scanFocusKey} visibleItems={visibleItems}
        moveResourceByDrag={moveResourceByDrag} specialDueMode={specialDueMode} updateSpecialDue={updateSpecialDue}
        nowMs={nowMs} resourceDragDisabled={resourceDragDisabled}
      />
      <PlanningBoardSeibanDrawer
        isOpen={drawerOpen}
        registeredFseibans={registeredFseibans}
        selectedFseibans={activeFseibans}
        dueDetailTargetFseiban={dueDetailTargetFseiban ?? [...activeFseibans][0] ?? null}
        machineNameBySeiban={machineNames}
        onOpenDueDetail={openDueDetail}
        onClose={() => {
          setDrawerOpen(false);
          setOrderRegistrationError(null);
        }}
        registrationError={orderRegistrationError}
        onRefreshOrder={orderConflict ? () => void refreshAfterOrderConflict() : undefined}
        onRegister={allocation === 'original' || !scopeReady ? async () => false : addSeiban}
        onRegisterMany={allocation === 'original' || !scopeReady ? async () => false : addSeibans}
        onToggle={(fseiban) => {
          if (interactionLocked) return;
          setDueDetailTargetFseiban(fseiban);
          persistChecks(activeFseibans.has(fseiban)
            ? [...writeQueue.uncheckedFseibans, fseiban]
            : writeQueue.uncheckedFseibans.filter((value) => value !== fseiban));
        }}
        onClear={() => {
          if (!interactionLocked) {
            persistChecks(registeredFseibans);
            setDueDetailTargetFseiban(null);
          }
        }}
        onMove={allocation === 'original' || writeBlocked || interactionLocked ? () => undefined : moveSeiban}
        orderReadOnly={allocation === 'original' || interactionLocked}
        orderBusy={writeBlocked || interactionLocked}
        orderStatus={interactionLocked ? (boardQuery.isError ? '一覧を読み込めませんでした。' : '一覧を読み込み中…') : null}
        candidates={candidateQuery.data?.candidates}
        candidatesToday={candidateQuery.data?.today}
        candidatesRangeStart={candidateQuery.data?.rangeStart}
        candidatesRangeEnd={candidateQuery.data?.rangeEnd}
        candidatesLoading={candidateQuery.isLoading || candidateQuery.isFetching}
        candidatesError={candidateQuery.isError}
        candidateScopeKey={category}
        showCompletedCandidates={showCompletedCandidates}
        onShowCompletedCandidatesChange={setShowCompletedCandidates}
      />
      <PlanningBoardDuePanels
        dueDetailFseiban={dueDetailFseiban} closeDueDetail={closeDueDetail} dueDetail={dueDetail}
        dueDetailQuery={dueDetailQuery} pendingDueScope={pendingDueScope} allocation={allocation}
        dueConflict={dueConflict} hasPendingSeiban={hasPendingSeiban} dueError={dueError}
        refreshDueDetail={refreshDueDetail} openDuePicker={openDuePicker} duePickerState={duePickerState}
        setDuePickerState={setDuePickerState} commitDueDate={commitDueDate}
      />
      <PlanningBoardBulkEditDialog
        editorOpen={editorOpen} editorPending={editorPending} setEditorOpen={setEditorOpen} editorItems={editorItems}
        editorError={editorError} editorConflict={editorConflict} refreshAfterConflict={refreshAfterConflict}
        allocation={allocation} writeBlocked={writeBlocked} editorSnapshot={editorSnapshot}
        canMoveResource={canMoveResource} data={data} resourceChoice={resourceChoice} setResourceChoice={setResourceChoice}
        loadQuery={loadQuery} dueMode={dueMode} setDueMode={setDueMode} dueDate={dueDate} setDueDate={setDueDate}
        offsetDays={offsetDays} setOffsetDays={setOffsetDays} applyEditor={applyEditor}
      />
    </main>
    </PlanningBoardPiecesContext.Provider></PlanningBoardPlacementContext.Provider>
    </PlanningBoardProcessChipsContext.Provider></DScheduleMinutesProvider>
  );
}
