import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


import {
  useKioskProductionScheduleResources,
  useSetKioskProductionScheduleRowCompletion,
  useKioskGrindingPlanningBoardProgressive,
  useKioskGrindingPlanningBoardLoad,
  useKioskGrindingPlanningBoardSeibanCandidates,
  useKioskGrindingPlanningBoardDueDetail,
  useUpdateKioskGrindingPlanningBoardOverrides,
  useUpdateKioskGrindingPlanningBoardPins,
  useUpdateKioskGrindingPlanningBoardDueScope,
  useUpdateKioskGrindingPlanningBoardRank,
  useUpdateKioskGrindingPlanningBoardResourceOrder,
  useUpdateKioskGrindingPlanningBoardResourceOrderBulk,
  useUpdateKioskGrindingPlanningBoardSeibanOrder
} from '../../api/hooks';
import { productionScheduleQueryKeys } from '../../api/queryKeys/productionSchedule';
import { createPlanningBoardSeibanActions } from '../../features/kiosk/grindingPlanningBoard/createPlanningBoardSeibanActions';
import { PlanningBoardBulkEditDialog } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardBulkEditDialog';
import { PlanningBoardDuePanels } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardDuePanels';
import { EMPTY_ITEMS, EMPTY_ORDER, todayJst, addUtcDays, displayedDue, defaultDueDateFor, applyOptimisticOverride } from '../../features/kiosk/grindingPlanningBoard/planningBoardPageModel';
import { PlanningBoardPageView } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardPageView';
import { PlanningBoardSeibanDrawer } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardSeibanDrawer';
import { PlanningBoardToolbar } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardToolbar';
import {
  resolveGrindingPlanningBoardResource,
  sortGrindingPlanningBoardItems
} from '../../features/kiosk/grindingPlanningBoard/sortGrindingPlanningBoardItems';
import { usePlanningBoardDueActions } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardDueActions';
import { usePlanningBoardLargeScreen } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardLargeScreen';
import { usePlanningBoardNotices } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardNotices';
import { usePlanningBoardPageGantt } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardPageGantt';
import { usePlanningBoardPageItems } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardPageItems';
import { usePlanningBoardWriteQueue } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue';
import { useUnsavedChangesGuard } from '../../features/navigation/useUnsavedChangesGuard';
import { useSingleFlight } from '../../hooks/useSingleFlight';

import type { CompletionOverlay, OrderPreview, ResourceOrderSnapshot, ResourceOrderHistory, DueMode, ResourceChoice, FeedbackKind, DuePickerState, PendingDueScopeUpdate } from '../../features/kiosk/grindingPlanningBoard/planningBoardPageModel';
import type { PlanningBoardAllocation, PlanningBoardStatus } from '../../features/kiosk/grindingPlanningBoard/types';
import type { PlanningBoardDisplayItem } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue';
import type {
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardOverrideItemRequest,
  GrindingPlanningBoardResourceOrderPlacement,
  GrindingPlanningBoardDueRequest,
  GrindingPlanningBoardSpecialDueKind
} from '@raspi-system/shared-types';

export function ProductionScheduleGrindingPlanningBoardPage() {
  const [categories, setCategories] = useState({ grinding: true, cutting: false });
  const category: GrindingPlanningBoardCategory = categories.grinding && categories.cutting ? 'all' : categories.grinding ? 'grinding' : 'cutting';
  const [pinMode, setPinMode] = useState(false);
  const [orderPreview, setOrderPreview] = useState<OrderPreview | null>(null);
  const [focusedSeiban, setFocusedSeiban] = useState<string | null>(null);
  const [scanFocusKey, setScanFocusKey] = useState(0);
  const [completionOverlay, setCompletionOverlay] = useState<ReadonlyMap<string, CompletionOverlay>>(new Map());
  const completionPendingRef = useRef(new Set<string>());
  const [completionPendingRowIds, setCompletionPendingRowIds] = useState<ReadonlySet<string>>(new Set());
  const { completionNotice, setCompletionNotice, scanNotice, setScanNotice } = usePlanningBoardNotices();
  useEffect(() => {
    if (!focusedSeiban) return;
    const clear = (event: KeyboardEvent) => { if (event.key === 'Escape') setFocusedSeiban(null); };
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
  const [activeFseibans, setActiveFseibans] = useState<ReadonlySet<string>>(new Set());
  const [showCompletedCandidates, setShowCompletedCandidates] = useState(false);
  const [selectedItemIdsByCategory, setSelectedItemIdsByCategory] = useState<Record<string, ReadonlySet<string>>>({});
  const [activeInitialized, setActiveInitialized] = useState(false);
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

  const queryClient = useQueryClient();
  const { mutateAsync: setCompletionAsync } = useSetKioskProductionScheduleRowCompletion();
  const boardQuery = useKioskGrindingPlanningBoardProgressive(
    { category, view, completionFilter: status },
    { refetchIntervalMs: editorOpen || orderPreview ? false : undefined }
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

  const data = boardQuery.data;
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
    sourceRevision,
    refresh: async () => {
      const result = await boardQuery.refetch();
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
  const displayItems = useMemo(() => {
    const items = [...queuedItems];
    const sourceRowIds = new Set(items.map((item) => item.sourceRowId));
    // Keep the row available for instant undo even after the filtered GET omits it.
    for (const [rowId, overlay] of completionOverlay) {
      if (!sourceRowIds.has(rowId) && overlay.siteKey === data?.siteKey &&
        (category === 'all' || overlay.category === category)) items.push(overlay.item);
    }
    return items.map((item) => {
      const overlay = completionOverlay.get(item.sourceRowId);
      if (!overlay || overlay.siteKey !== data?.siteKey || item.completionSource === 'import') return item;
      return { ...item, isCompleted: overlay.isCompleted, completionSource: overlay.completionSource };
    }).filter((item) => status === 'all' || item.isCompleted === (status === 'complete'));
  }, [queuedItems, completionOverlay, data?.siteKey, category, status]);

  useEffect(() => {
    if (!data || boardQuery.isPlaceholderData) return;
    setCompletionOverlay((current) => {
      const next = new Map(current);
      for (const item of data.items) {
        const overlay = next.get(item.sourceRowId);
        if (!overlay || overlay.siteKey !== data.siteKey || overlay.snapshotId === data.snapshotId ||
          completionPendingRowIds.has(item.sourceRowId)) continue;
        if (item.completionSource === 'import' || (item.isCompleted === overlay.isCompleted &&
          (item.completionSource ?? null) === overlay.completionSource)) next.delete(item.sourceRowId);
        // One disagreeing refresh after the save may have started before it; a second one is the truth
        // (e.g. another kiosk changed the row again).
        else if (overlay.saved && overlay.staleSnapshotId && overlay.staleSnapshotId !== data.snapshotId) next.delete(item.sourceRowId);
        else if (overlay.saved && !overlay.staleSnapshotId) next.set(item.sourceRowId, { ...overlay, staleSnapshotId: data.snapshotId });
      }
      return next.size === current.size && [...next].every(([key, value]) => current.get(key) === value) ? current : next;
    });
  }, [data, boardQuery.isPlaceholderData, completionPendingRowIds]);

  const writeBlocked = writeQueue.blocked || rankConflict || orderConflict || Boolean(orderPreview);
  const rankDisabled = useCallback((item: GrindingPlanningBoardItem) =>
    !rankMutationReady || writeBlocked || hasPendingSeiban(item.fseiban, true),
  [rankMutationReady, writeBlocked, hasPendingSeiban]);
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
    if (!activeInitialized || siteChanged) {
      setActiveFseibans(new Set(data.seibanOrder));
      setActiveInitialized(true);
    }
    if (!openInitialized || siteChanged) {
      setOpenFseibans(new Set(data.seibanOrder.length ? data.seibanOrder : data.registeredFseibans));
      setOpenInitialized(true);
    }
    if (!writeQueue.pending) {
      const added = data.registeredFseibans.filter((value) => previous != null && !previous.has(value));
      if (added.length) {
        setActiveFseibans((current) => new Set([...current, ...added]));
        setOpenFseibans((current) => new Set([...current, ...added]));
      }
      registeredServerFseibansRef.current = new Set(data.registeredFseibans);
    }
  }, [activeInitialized, boardQuery.isPlaceholderData, data, openInitialized, writeQueue.pending]);

  useEffect(() => {
    const registered = new Set(registeredFseibans);
    const prune = (current: ReadonlySet<string>) => [...current].every((value) => registered.has(value))
      ? current : new Set([...current].filter((value) => registered.has(value)));
    setActiveFseibans(prune);
    setOpenFseibans(prune);
    setDueDetailTargetFseiban((current) => current && registered.has(current) ? current : null);
  }, [registeredFseibans]);

  const { itemsBySeiban, sortedItemsBySeiban, machineNames, visibleItems, specialDueCounts, selectedItemIds, selectedVisibleItems } = usePlanningBoardPageItems({
    displayItems, registeredFseibans, view, allocation, data, activeFseibans, selectedItemIdsByCategory, category
  });
  const editorItems = editorSnapshot?.items ?? [];
  const resourceDragDisabled = writeBlocked;
  const currentItemsRef = useRef(displayItems);
  currentItemsRef.current = displayItems;
  const specialDueModeRef = useRef(specialDueMode);
  specialDueModeRef.current = specialDueMode;

  const toggleItem = useCallback((item: GrindingPlanningBoardItem, selected: boolean) => {
    if (!scopeReady || item.isCompleted) return;
    setSelectedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      if (selected) next.add(item.itemId); else next.delete(item.itemId);
      return { ...current, [category]: next };
    });
  }, [category, scopeReady]);
  const toggleCompletion = useCallback(async (item: GrindingPlanningBoardItem, intent: 'complete' | 'incomplete') => {
    const currentItem = currentItemsRef.current.find((candidate) => candidate.sourceRowId === item.sourceRowId) ?? item;
    if (interactionLocked || !data || item.kind !== 'row' || currentItem.completionSource === 'import' ||
      completionPendingRef.current.has(item.sourceRowId)) return;
    completionPendingRef.current.add(item.sourceRowId);
    setCompletionPendingRowIds(new Set(completionPendingRef.current));
    setCompletionOverlay((current) => new Map(current).set(item.sourceRowId, {
      isCompleted: intent === 'complete', completionSource: intent === 'complete' ? 'manual' : null,
      item: currentItem, siteKey: data.siteKey,
      category: data.resourceCategories?.[item.originalResourceCd ?? ''] ?? category,
      snapshotId: data.snapshotId
    }));
    try {
      await setCompletionAsync({ rowId: item.sourceRowId, intent });
      setCompletionOverlay((current) => {
        const overlay = current.get(item.sourceRowId);
        return overlay ? new Map(current).set(item.sourceRowId, { ...overlay, saved: true }) : current;
      });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
      if (intent === 'complete') {
        setSelectedItemIdsByCategory((current) => Object.fromEntries(Object.entries(current).map(([key, ids]) => {
          const next = new Set(ids);
          next.delete(item.itemId);
          return [key, next];
        })));
        setCompletionNotice({ item });
      } else {
        setCompletionNotice(null);
      }
    } catch {
      setCompletionOverlay((current) => {
        const next = new Map(current);
        next.delete(item.sourceRowId);
        return next;
      });
      notify('完了状態を保存できませんでした。時間をおいて再試行してください。', 'error');
    } finally {
      completionPendingRef.current.delete(item.sourceRowId);
      setCompletionPendingRowIds(new Set(completionPendingRef.current));
    }
  // setCompletionNotice is the unchanged React state setter returned by usePlanningBoardNotices.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactionLocked, data, category, setCompletionAsync, queryClient, notify]);
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
          const item = context.item(originals.find((candidate) => candidate.itemId === request.itemId)!);
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

  const historyScope = `${data?.siteKey ?? ''}:${category}`;
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
        return { ...display, items: display.items.map((candidate) => ranks.has(candidate.itemId) ? { ...candidate, alternateRank: ranks.get(candidate.itemId)! } : candidate) };
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

  const { refreshAfterOrderConflict, removeSeiban, addSeibans, addSeiban, moveSeiban } = createPlanningBoardSeibanActions({
    data, scopeReady, writeBlocked, allocation, setOrderRegistrationError, enqueueWrite,
    registeredFseibans, updateOrder, setOrderConflict, notify, boardQuery, setRankConflict,
    acceptRefreshedState, activeFseibans, openFseibans, setActiveFseibans, setOpenFseibans,
    setDueDetailTargetFseiban, setDueDetailFseiban
  });

  const {
    focusItems, gantt, orderActionsDisabled, ganttLayout, lastResourceOrder, handleOrderScan,
    moveResourceInGantt, sortResourceOrdersByDue, proposeResourceOrder, applyResourceOrder, togglePin, undoResourceOrder
  } = usePlanningBoardPageGantt({
    focusedFseiban, sortedItemsBySeiban, view, visibleItems, nowMs, ganttEnabled, allocation, category,
    data, registeredFseibans, bulkReady, rankMutationReady, writeBlocked, writeQueue, orderPreview,
    resourceOrderHistory, historyScope, currentItemsRef, hasPendingSeiban, enqueueWrite, updateResourceOrderBulkAsync,
    setColorBySeiban, setFocusedFseiban, setOpenFseibans, setFocusedSeiban, setScanFocusKey, setScanNotice,
    scopeReady, pinMode, canMoveResource, snapshotResourceOrder, notify, resourceOrderHistoryId, enqueueOverrides,
    setResourceOrderHistory, rememberResourceOrder, setPinMode, setOrderPreview, sourceRevision, rankConflict,
    orderConflict, updatePinsAsync
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
  const toolbarSelectedItems = focusedFseiban
    ? selectedVisibleItems.filter((item) => item.fseiban === focusedFseiban)
    : selectedVisibleItems;
  return (
    <main className="min-h-0 w-full shrink-0 overflow-hidden bg-slate-950 px-2 py-2 text-white sm:px-3">
      <PlanningBoardToolbar
        largeScreen={largeScreen} onToggleLargeScreen={() => changeLargeScreen(!largeScreen)}
        colorBySeiban={colorBySeiban} onToggleColorBySeiban={() => setColorBySeiban((enabled) => !enabled)}
        onOrderScan={handleOrderScan} focusedSeiban={focusedSeiban} onClearSeibanFocus={() => setFocusedSeiban(null)}
        ganttEnabled={ganttEnabled}
        onToggleGantt={() => { setFocusedSeiban(null); setPinMode(false); setGanttEnabled((enabled) => !enabled); }}
        ganttScale={gantt.scale}
        onGanttScaleChange={gantt.changeScale}
        ganttMode={gantt.mode} onGanttModeChange={(mode) => { setPinMode(false); gantt.changeMode(mode); }}
        lateCount={ganttLayout.lateCount} onNextLate={gantt.scrollToNextLate}
        pinMode={pinMode} onTogglePinMode={() => setPinMode((value) => !value)}
        orderPreview={orderPreview} previewPending={writeQueue.pending || writeQueue.blocked || rankConflict || orderConflict}
        onApplyOrder={applyResourceOrder} onCancelOrder={() => setOrderPreview(null)}
        onProposeOrder={proposeResourceOrder} onSortDue={sortResourceOrdersByDue} onUndoOrder={undoResourceOrder}
        orderDisabled={orderActionsDisabled} canUndoOrder={Boolean(lastResourceOrder)}
        overlapCount={ganttLayout.overlapCount}
        onNextOverlap={gantt.scrollToNextOverlap}
        categories={categories}
        view={view}
        status={status}
        allocation={allocation}
        selectedCount={toolbarSelectedItems.length}
        scopeDisabled={writeQueue.pending || Boolean(orderPreview)}
        bulkDisabled={allocation === 'original' || toolbarSelectedItems.length === 0 || !bulkReady || writeBlocked}
        registeredCount={registeredFseibans.length}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCategoriesChange={(value) => { if (!writeQueue.pending && (value.grinding || value.cutting)) setCategories(value); }}
        onViewChange={(next) => { setPinMode(false); setView(next); }}
        onStatusChange={(value) => { if (!writeQueue.pending) setStatus(value); }}
        onAllocationChange={(value) => { if (!writeQueue.pending) setAllocation(value); }}
        onOpenDueEditor={() => openEditor(toolbarSelectedItems)}
        specialDueMode={view === 'resource' ? specialDueMode : null}
        onSpecialDueModeChange={view === 'resource' ? setSpecialDueMode : undefined}
        specialDueDisabled={allocation === 'original' || interactionLocked || resourceDragDisabled}
        feedback={feedback ? (
          <div className={`flex h-full min-w-0 items-center gap-1 rounded-md px-2 text-xs ${
            feedbackKind === 'error' ? 'bg-rose-950/70 text-rose-100'
              : feedbackKind === 'processing' ? 'bg-sky-950/60 text-sky-100'
                : 'bg-emerald-950/60 text-emerald-100'
          }`} role="status">
            <span className="min-w-0 flex-1 truncate">{feedback}</span>
            {orderConflict || rankConflict ? (
              <button type="button" className="h-11 w-11 shrink-0 rounded text-lg text-emerald-100" onClick={() => void refreshAfterOrderConflict()} aria-label="最新状態を取得">↻</button>
            ) : null}
            <button type="button" className="h-11 w-11 shrink-0 text-slate-300" onClick={clearFeedback} aria-label="通知を閉じる">✕</button>
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
        <button type="button" className="min-h-7 rounded border border-emerald-300 px-2 disabled:opacity-60" disabled={interactionLocked || completionPendingRowIds.has(completionNotice.item.sourceRowId)}
          onClick={() => { void toggleCompletion(completionNotice.item, 'incomplete'); setCompletionNotice(null); }}>↶ 戻す</button>
      </div>}
      {scanNotice && <p role="status" className="pointer-events-none fixed left-1/2 top-16 z-[90] -translate-x-1/2 rounded-lg bg-emerald-900 px-4 py-2 text-sm font-bold text-emerald-50 shadow-lg">{scanNotice.text}</p>}
      {boardQuery.isError ? <p className="p-5 text-sm text-rose-200">一覧を読み込めませんでした。</p> : null}
      <PlanningBoardPageView
        data={data} ganttEnabled={ganttEnabled} focusedSeiban={focusedSeiban} setFocusedSeiban={setFocusedSeiban}
        colorBySeiban={colorBySeiban} registeredFseibans={registeredFseibans} gantt={gantt} ganttLayout={ganttLayout}
        view={view} orderPreview={orderPreview} category={category} resourcesQuery={resourcesQuery}
        pinMode={pinMode} togglePin={togglePin} selectedItemIds={selectedItemIds} toggleItem={toggleItem}
        toggleCompletion={toggleCompletion} completionPendingRowIds={completionPendingRowIds}
        moveDueByDrag={moveDueByDrag} reorderResourceByDrag={reorderResourceByDrag} moveResourceInGantt={moveResourceInGantt}
        canMoveResource={canMoveResource} interactionLocked={interactionLocked} writeQueue={writeQueue}
        allocation={allocation} writeBlocked={writeBlocked} rankMutationReady={rankMutationReady}
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
        onRemove={allocation === 'original' || !scopeReady ? () => undefined : removeSeiban}
        onToggle={(fseiban) => {
          if (interactionLocked) return;
          setDueDetailTargetFseiban(fseiban);
          setActiveFseibans((current) => {
            const next = new Set(current);
            if (next.has(fseiban)) next.delete(fseiban); else next.add(fseiban);
            return next;
          });
        }}
        onClear={() => {
          if (!interactionLocked) {
            setActiveFseibans(new Set());
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
  );
}
