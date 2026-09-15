import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


import {
  useKioskProductionScheduleResources,
  useKioskGrindingPlanningBoardProgressive,
  useKioskGrindingPlanningBoardSeibanCandidates,
  useKioskGrindingPlanningBoardDueDetail,
  useUpdateKioskGrindingPlanningBoardOverrides,
  useUpdateKioskGrindingPlanningBoardDueScope,
  useUpdateKioskGrindingPlanningBoardRank,
  useUpdateKioskGrindingPlanningBoardResourceOrder,
  useUpdateKioskGrindingPlanningBoardSeibanOrder
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { PlanningBoardFocusView } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardFocusView';
import { formatPlanningBoardLoadSummary, formatPlanningBoardResourceLoad } from '../../features/kiosk/grindingPlanningBoard/planningBoardLoad';
import { PlanningBoardResourceView } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardResourceView';
import { PlanningBoardSeibanDrawer } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardSeibanDrawer';
import { PlanningBoardSeibanPane } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardSeibanPane';
import { PlanningBoardToolbar } from '../../features/kiosk/grindingPlanningBoard/PlanningBoardToolbar';
import {
  resolveGrindingPlanningBoardDueDate,
  resolveGrindingPlanningBoardResource,
  sortGrindingPlanningBoardItems
} from '../../features/kiosk/grindingPlanningBoard/sortGrindingPlanningBoardItems';
import { usePlanningBoardWriteQueue } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue';
import { LeaderBoardDueAssistPanel } from '../../features/kiosk/leaderOrderBoard/LeaderBoardDueAssistPanel';
import { normalizeDueDateInput } from '../../features/kiosk/productionSchedule/dueManagement';
import { useUnsavedChangesGuard } from '../../features/navigation/useUnsavedChangesGuard';

import type { PlanningBoardAllocation, PlanningBoardStatus } from '../../features/kiosk/grindingPlanningBoard/types';
import type { PlanningBoardDisplayItem } from '../../features/kiosk/grindingPlanningBoard/usePlanningBoardWriteQueue';
import type {
  GrindingPlanningBoardDueScope,
  GrindingPlanningBoardDueScopeSnapshot,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardOverrideItemRequest,
  GrindingPlanningBoardResourceOrderPlacement,
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardDueRequest,
  GrindingPlanningBoardSpecialDueKind
} from '@raspi-system/shared-types';

const EMPTY_ITEMS: GrindingPlanningBoardItem[] = [];
const EMPTY_ORDER: string[] = [];

const todayJst = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`;
};

function addUtcDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function shortDate(date: string | null): string {
  return date ? date.slice(5).replace('-', '/') : '未定';
}

function displayedDue(item: GrindingPlanningBoardItem, allocation: PlanningBoardAllocation): string | null {
  return resolveGrindingPlanningBoardDueDate(item, allocation);
}

function defaultDueDateFor(items: readonly GrindingPlanningBoardItem[], allocation: PlanningBoardAllocation): string {
  const currentDates = items
    .map((item) => displayedDue(item, allocation))
    .filter((date): date is string => Boolean(date));
  const base = [...currentDates, todayJst()].sort().at(-1) ?? todayJst();
  return addUtcDays(base, 1);
}

type DueMode = 'none' | 'date' | 'offsetDays' | 'restore';
type ResourceChoice = 'unchanged' | 'restore' | string;
type FeedbackKind = 'processing' | 'success' | 'error';

type DuePickerState = {
  fseiban: string;
  value: string;
  scope: GrindingPlanningBoardDueScope;
  snapshot: Pick<GrindingPlanningBoardDueScopeSnapshot, 'sourceGenerationToken' | 'scopeRevision'>;
};

type PendingDueScopeUpdate = {
  fseiban: string;
  scope: GrindingPlanningBoardDueScope;
  dueDate: string;
  baseScopeRevision: string;
  responseScopeRevision: string | null;
};

function applyOptimisticOverride(
  item: GrindingPlanningBoardItem,
  request: GrindingPlanningBoardOverrideItemRequest
): PlanningBoardDisplayItem {
  const nextResource = request.resourceCd === undefined
    ? item.effectiveResourceCd
    : request.resourceCd ?? item.originalResourceCd;
  const resourceChanged = request.resourceCd !== undefined && nextResource !== item.effectiveResourceCd;

  let nextDue = item.effectiveDueDate;
  let dueChanged = false;
  if (request.due?.kind === 'date') {
    nextDue = request.due.date;
    dueChanged = nextDue !== item.effectiveDueDate;
  } else if (request.due?.kind === 'offsetDays') {
    const base = item.effectiveDueDate ?? item.originalDueDate ?? todayJst();
    nextDue = addUtcDays(base, request.due.days);
    dueChanged = nextDue !== item.effectiveDueDate;
  } else if (request.due?.kind === 'restore' && item.kind === 'row') {
    nextDue = item.originalDueDate;
    dueChanged = nextDue !== item.effectiveDueDate;
  }

  return {
    ...item,
    effectiveResourceCd: nextResource,
    effectiveDueDate: nextDue,
    alternateRank: resourceChanged || dueChanged ? null : item.alternateRank,
    specialDue: request.specialDue === null ? null : item.specialDue,
    ...(request.specialDue !== undefined ? { pendingSpecialDue: request.specialDue } : {})
  };
}

export function ProductionScheduleGrindingPlanningBoardPage() {
  const [category, setCategory] = useState<'grinding' | 'cutting'>('grinding');
  const [view, setView] = useState<'seiban' | 'resource'>('seiban');
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
    load: GrindingPlanningBoardResponse['load'];
  } | null>(null);
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

  const boardQuery = useKioskGrindingPlanningBoardProgressive(
    { category, view, completionFilter: status },
    { refetchIntervalMs: editorOpen ? false : undefined }
  );
  const candidateQuery = useKioskGrindingPlanningBoardSeibanCandidates({
    category,
    completionFilter: showCompletedCandidates ? 'all' : 'incomplete'
  }, { enabled: drawerOpen });
  const resourcesQuery = useKioskProductionScheduleResources({ pauseRefetch: true });
  const dueDetailQuery = useKioskGrindingPlanningBoardDueDetail(dueDetailFseiban);
  const { mutateAsync: updateOverridesAsync } = useUpdateKioskGrindingPlanningBoardOverrides({ invalidateOnSuccess: false });
  const updateDueScope = useUpdateKioskGrindingPlanningBoardDueScope({ invalidateOnSuccess: false });
  const { mutateAsync: updateRankAsync } = useUpdateKioskGrindingPlanningBoardRank({ invalidateOnSuccess: false });
  const { mutateAsync: updateResourceOrderAsync } = useUpdateKioskGrindingPlanningBoardResourceOrder({ invalidateOnSuccess: false });
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
  const interactionLocked = !scopeReady;
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
      if (dueDetailIdentityRef.current) await dueDetailQuery.refetch();
      return result;
    },
    onStart: (label) => notify(`${label}を保存中…`, 'processing'),
    onSuccess: (label) => notify(`${label}を保存しました。`, 'success'),
    onError: handleError
  });
  const { enqueue: enqueueWrite, items: displayItems, order: registeredFseibans, hasPendingSeiban, acceptRefreshedState } = writeQueue;
  const writeBlocked = writeQueue.blocked || rankConflict || orderConflict;
  const rankDisabled = useCallback((item: GrindingPlanningBoardItem) =>
    !rankMutationReady || writeBlocked || hasPendingSeiban(item.fseiban, true),
  [rankMutationReady, writeBlocked, hasPendingSeiban]);
  useUnsavedChangesGuard(writeQueue.pending);

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

  const itemsBySeiban = useMemo(() => {
    const grouped = new Map<string, GrindingPlanningBoardItem[]>();
    for (const item of displayItems) {
      const group = grouped.get(item.fseiban) ?? [];
      group.push(item);
      grouped.set(item.fseiban, group);
    }
    return grouped;
  }, [displayItems]);
  const sortedItemsBySeiban = useMemo(() => {
    const sorted = new Map<string, GrindingPlanningBoardItem[]>();
    for (const [fseiban, group] of itemsBySeiban) {
      sorted.set(fseiban, sortGrindingPlanningBoardItems(group, registeredFseibans, view, allocation));
    }
    return sorted;
  }, [allocation, itemsBySeiban, registeredFseibans, view]);
  const machineNames = useMemo(() => {
    const result = new Map<string, string | null>();
    for (const item of displayItems) if (!result.has(item.fseiban)) result.set(item.fseiban, item.machineName);
    return result;
  }, [displayItems]);
  const visibleItems = useMemo(
    () => displayItems.filter((item) => activeFseibans.has(item.fseiban)),
    [activeFseibans, displayItems]
  );
  const specialDueCounts = useMemo(() => {
    const counts = { overnight: 0, today: 0 };
    for (const item of visibleItems) {
      const preview = item as PlanningBoardDisplayItem;
      const kind = preview.pendingSpecialDue !== undefined ? preview.pendingSpecialDue : item.specialDue?.kind;
      if (kind) counts[kind] += 1;
    }
    return counts;
  }, [visibleItems]);
  const selectedItemIds = useMemo(
    () => {
      const selectedItemIdsForCategory = selectedItemIdsByCategory[category] ?? new Set<string>();
      return new Set(visibleItems.filter((item) => !item.isCompleted && selectedItemIdsForCategory.has(item.itemId)).map((item) => item.itemId));
    },
    [category, selectedItemIdsByCategory, visibleItems]
  );
  const selectedVisibleItems = useMemo(
    () => visibleItems.filter((item) => !item.isCompleted && selectedItemIds.has(item.itemId)),
    [selectedItemIds, visibleItems]
  );
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

  const enqueueOverrides = useCallback((
    originals: readonly GrindingPlanningBoardItem[], requests: GrindingPlanningBoardOverrideItemRequest[],
    label: string, onFailed?: (error: unknown) => void, capturedSourceRevision?: string
  ) => {
    if (writeBlocked || originals.some((item) => hasPendingSeiban(item.fseiban, true))) return false;
    const patches = new Map(requests.map((request) => [request.itemId, request]));
    return enqueueWrite({
      label, itemIds: originals.map((item) => item.itemId), seibans: [...new Set(originals.map((item) => item.fseiban))],
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
  }, [enqueueWrite, updateOverridesAsync, writeBlocked, hasPendingSeiban]);

  const updateSpecialDue = useCallback((original: GrindingPlanningBoardItem) => {
    const item = currentItemsRef.current.find((candidate) => candidate.itemId === original.itemId) ?? original;
    const mode = specialDueModeRef.current;
    if (!scopeReady || !rankMutationReady || allocation === 'original' || !mode || item.isCompleted) return;
    const preview = item as PlanningBoardDisplayItem;
    const kind = preview.pendingSpecialDue !== undefined ? preview.pendingSpecialDue : item.specialDue?.kind;
    const next = kind === mode ? null : mode;
    enqueueOverrides([item], [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, specialDue: next }],
      next === null ? '特別納期の解除' : next === 'today' ? '今日中' : '朝まで');
  }, [allocation, enqueueOverrides, rankMutationReady, scopeReady]);

  const openEditor = useCallback((items: readonly GrindingPlanningBoardItem[]) => {
    if (!scopeReady || writeBlocked || items.some((item) => hasPendingSeiban(item.fseiban, true))) return;
    const target = items.filter((item) => !item.isCompleted);
    if (target.length === 0) return;
    if (!data) return;
    editorGenerationRef.current += 1;
    setEditorSnapshot({
      items: [...target],
      sourceRevision: data.sourceRevision,
      resources: [...data.resources],
      load: data.load
    });
    setResourceChoice('unchanged');
    setDueMode('none');
    setDueDate(defaultDueDateFor(target, allocation));
    setOffsetDays('1');
    clearFeedback();
    setEditorError(null);
    setEditorConflict(false);
    setEditorOpen(true);
  }, [allocation, clearFeedback, data, scopeReady, writeBlocked, hasPendingSeiban]);

  const openDueDetail = useCallback((fseiban: string) => {
    dueDetailIdentityRef.current = fseiban;
    setDueDetailTargetFseiban(fseiban);
    setDueDetailFseiban(fseiban);
    setDuePickerState(null);
    setDueConflict(false);
    setDueError(null);
  }, []);

  const closeDueDetail = useCallback(() => {
    dueDetailIdentityRef.current = null;
    setDuePickerState(null);
    setDueDetailFseiban(null);
    setDueConflict(false);
    setDueError(null);
  }, []);

  const openDuePicker = useCallback((scope: GrindingPlanningBoardDueScope, currentDueDate: string | null) => {
    const detail = dueDetailQuery.data;
    if (!dueDetailFseiban || !detail || allocation === 'original' || dueConflict || hasPendingSeiban(dueDetailFseiban) || pendingDueScope?.fseiban === dueDetailFseiban) return;
    setDueError(null);
    setDueConflict(false);
    setDuePickerState({
      fseiban: dueDetailFseiban,
      value: normalizeDueDateInput(currentDueDate),
      scope,
      snapshot: {
        sourceGenerationToken: detail.sourceGenerationToken,
        scopeRevision: detail.scopeRevision
      }
    });
  }, [allocation, dueConflict, dueDetailFseiban, dueDetailQuery.data, pendingDueScope, hasPendingSeiban]);

  const refreshDueDetail = useCallback(async () => {
    setDueError('最新状態を取得しています…');
    notify('最新状態を取得しています…', 'processing');
    try {
      const [detailResult, boardResult] = await Promise.all([dueDetailQuery.refetch(), boardQuery.refetch()]);
      if (detailResult.isError || boardResult.isError) {
        setDueError('最新状態を取得できませんでした。再試行してください。');
        return;
      }
      setDueConflict(false);
      setRankConflict(false);
      acceptRefreshedState();
      setDueError(null);
      notify('最新状態を取得しました。対象を選び直して再適用してください。', 'success');
    } catch {
      setDueError('最新状態を取得できませんでした。再試行してください。');
      notify('最新状態を取得できませんでした。再試行してください。', 'error');
    }
  }, [boardQuery, dueDetailQuery, notify, acceptRefreshedState]);

  const commitDueDate = useCallback((nextDueDate: string) => {
    const current = duePickerState;
    if (!current || allocation === 'original' || writeBlocked || hasPendingSeiban(current.fseiban)) return;
    const pendingUpdate: PendingDueScopeUpdate = { fseiban: current.fseiban, scope: current.scope, dueDate: nextDueDate,
      baseScopeRevision: current.snapshot.scopeRevision, responseScopeRevision: null };
    const accepted = enqueueWrite({ label: `${current.fseiban}の納期`, itemIds: [], seibans: [current.fseiban], wholeSeiban: true,
      apply: (display) => display,
      save: async () => {
        const result = await updateDueScope.mutateAsync({ fseiban: current.fseiban,
          payload: { ...current.snapshot, scope: current.scope, dueDate: nextDueDate } });
        setPendingDueScope((pending) => pending?.fseiban === current.fseiban
          ? { ...pending, responseScopeRevision: result.scopeRevision } : pending);
        // Scope writes invalidate item revisions without returning them. Read them before this seiban becomes editable again.
        const [detail, board] = await Promise.all([dueDetailQuery.refetch(), boardQuery.refetch()]);
        if (detail.isError || board.isError) throw new Error('納期保存後の最新状態を取得できませんでした。');
        return {};
      },
      onSaved: () => {
        setPendingDueScope((pending) => pending?.fseiban === current.fseiban ? null : pending);
        if (dueDetailIdentityRef.current === current.fseiban) { setDueConflict(false); setDueError(null); }
      },
      onFailed: (error) => {
        setPendingDueScope((pending) => pending?.fseiban === current.fseiban ? null : pending);
        if (dueDetailIdentityRef.current !== current.fseiban) return;
        const conflict = isAxiosError(error) && error.response?.status === 409;
        setDueConflict(conflict);
        setDueError(conflict ? '表示中の納期が更新されています。最新状態を取得してから再適用してください。' : '納期を保存できませんでした。最新状態を取得して確認してください。');
      }
    });
    if (accepted) { setPendingDueScope(pendingUpdate); setDuePickerState(null); }
  }, [allocation, boardQuery, dueDetailQuery, duePickerState, enqueueWrite, updateDueScope, writeBlocked, hasPendingSeiban]);

  const applyEditor = async () => {
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
    const editorGeneration = editorGenerationRef.current;
    const accepted = enqueueOverrides(editorItems, items, `${items.length}件の変更`, (error) => {
      if (editorGenerationRef.current !== editorGeneration) return;
      const conflict = isAxiosError(error) && error.response?.status === 409;
      setEditorConflict(conflict);
      setEditorError(conflict ? '表示中のデータが更新されています。最新状態を取得してから対象を選び直してください。' : '保存できませんでした。入力内容と通信状態を確認してください。');
      setEditorOpen(true);
    }, editorSnapshot?.sourceRevision);
    if (accepted) setEditorOpen(false);
  };

  const moveResourceByDrag = useCallback((item: GrindingPlanningBoardItem, targetResource: string) => {
    if (!data || !scopeReady || !rankMutationReady || allocation === 'original' || item.isCompleted ||
      !data.resources.includes(targetResource) || resolveGrindingPlanningBoardResource(item, allocation) === targetResource) return;
    enqueueOverrides([item], [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, resourceCd: targetResource }], '資源CD');
  }, [allocation, data, enqueueOverrides, rankMutationReady, scopeReady]);

  const reorderResourceByDrag = useCallback((item: GrindingPlanningBoardItem, targetItem: GrindingPlanningBoardItem,
    placement: GrindingPlanningBoardResourceOrderPlacement) => {
    const resource = resolveGrindingPlanningBoardResource(item, allocation);
    if (!data || !scopeReady || !rankMutationReady || writeBlocked || allocation === 'original' || item.isCompleted || targetItem.isCompleted ||
      !resource || resource !== resolveGrindingPlanningBoardResource(targetItem, allocation) ||
      (item.specialDue?.expiresAt ?? null) !== (targetItem.specialDue?.expiresAt ?? null) ||
      hasPendingSeiban(item.fseiban, true) || hasPendingSeiban(targetItem.fseiban, true)) return;
    const affected = currentItemsRef.current.filter((candidate) => resolveGrindingPlanningBoardResource(candidate, allocation) === resource);
    enqueueWrite({ label: '資源CD内の順序', itemIds: affected.map((candidate) => candidate.itemId),
      seibans: [...new Set(affected.map((candidate) => candidate.fseiban))], order: true,
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
  }, [allocation, data, enqueueWrite, rankMutationReady, scopeReady, updateResourceOrderAsync, writeBlocked, hasPendingSeiban]);

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

  const persistOrder = (nextOrder: string[], onAccepted?: () => void, onRejected?: () => void): Promise<boolean> => {
    if (!data || !scopeReady || writeBlocked || allocation === 'original') return Promise.resolve(false);
    if (nextOrder.length > 50) {
      setOrderRegistrationError('登録上限50件を超えるため保存できません。選択を減らしてください。');
      return Promise.resolve(false);
    }
    setOrderRegistrationError(null);
    return new Promise((resolve) => {
      const accepted = enqueueWrite({ label: '製番順', itemIds: [], seibans: [...new Set([...registeredFseibans, ...nextOrder])], order: true,
        apply: (display) => ({ ...display, order: nextOrder }),
        save: async (context) => {
          const result = await updateOrder.mutateAsync({ sourceRevision: context.sourceRevision, fseibans: nextOrder });
          return { sourceRevision: result.sourceRevision, order: result.seibanOrder };
        },
        onSaved: () => resolve(true),
        onFailed: (error) => {
          onRejected?.();
          resolve(false);
          const conflict = isAxiosError(error) && error.response?.status === 409;
          setOrderConflict(conflict);
          setOrderRegistrationError(conflict ? '製番順が他端末で更新されています。最新状態を取得してから再登録してください。' : '製番登録を保存できませんでした。通信状態と入力値を確認してください。');
        }
      });
      if (accepted) onAccepted?.(); else resolve(false);
    });
  };

  const refreshAfterOrderConflict = async () => {
    notify('最新状態を取得しています…', 'processing');
    const result = await boardQuery.refetch();
    if (result.isError || !result.data) { notify('最新状態を取得できませんでした。再試行してください。', 'error'); return; }
    setOrderRegistrationError(null); setOrderConflict(false); setRankConflict(false);
    acceptRefreshedState();
    notify('最新状態を取得しました。', 'success');
  };
  const removeSeiban = (fseiban: string) => {
    const wasActive = activeFseibans.has(fseiban);
    const wasOpen = openFseibans.has(fseiban);
    void persistOrder(registeredFseibans.filter((value) => value !== fseiban), () => {
      setActiveFseibans((current) => new Set([...current].filter((value) => value !== fseiban)));
      setOpenFseibans((current) => new Set([...current].filter((value) => value !== fseiban)));
      setDueDetailTargetFseiban((current) => current === fseiban ? null : current);
      setDueDetailFseiban((current) => current === fseiban ? null : current);
    }, () => {
      if (wasActive) setActiveFseibans((current) => new Set([...current, fseiban]));
      if (wasOpen) setOpenFseibans((current) => new Set([...current, fseiban]));
    });
  };
  const addSeibans = async (fseibans: readonly string[]): Promise<boolean> => {
    const additions = [...new Set(fseibans.map((value) => value.trim()).filter(Boolean))].filter((value) => !registeredFseibans.includes(value));
    if (!additions.length) return true;
    return persistOrder([...additions, ...registeredFseibans], () => {
      setActiveFseibans((current) => new Set([...additions, ...current]));
      setOpenFseibans((current) => new Set([...additions, ...current]));
    }, () => {
      setActiveFseibans((current) => new Set([...current].filter((value) => !additions.includes(value))));
      setOpenFseibans((current) => new Set([...current].filter((value) => !additions.includes(value))));
    });
  };
  const addSeiban = async (fseiban: string): Promise<boolean> => {
    if (!fseiban.trim() || registeredFseibans.includes(fseiban.trim())) return false;
    return addSeibans([fseiban]);
  };
  const moveSeiban = (fseiban: string, direction: 'up' | 'down') => {
    const index = registeredFseibans.indexOf(fseiban); const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= registeredFseibans.length) return;
    const next = [...registeredFseibans]; [next[index], next[target]] = [next[target], next[index]];
    void persistOrder(next);
  };

  const previewDue = (item: GrindingPlanningBoardItem) => {
    const before = displayedDue(item, allocation);
    const base = before ?? todayJst();
    if (dueMode === 'date') return `${shortDate(before)} → ${shortDate(dueDate)}`;
    if (dueMode === 'offsetDays') {
      const offset = Number(offsetDays);
      return Number.isInteger(offset) && offset >= 1
        ? `${shortDate(before)} → ${shortDate(addUtcDays(base, offset))}`
        : `${shortDate(before)} → 入力エラー`;
    }
    if (dueMode === 'restore') return `${shortDate(before)} → ${shortDate(item.originalDueDate)}`;
    return `${shortDate(before)} → 変更なし`;
  };

  const focusItems = useMemo(
    () => focusedFseiban ? sortedItemsBySeiban.get(focusedFseiban) ?? [] : [],
    [focusedFseiban, sortedItemsBySeiban]
  );
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
  const editorResources = editorSnapshot?.resources ?? [];
  const projectedLoad = (resource: string) => {
    const summary = editorSnapshot?.load.find((entry) => entry.resourceCd === resource);
    const base = allocation === 'original' ? summary?.originalRequiredMinutes : summary?.alternateRequiredMinutes;
    const baseUnknown = allocation === 'original' ? summary?.originalUnknownItemCount : summary?.alternateUnknownItemCount;
    let delta = 0;
    let unknownDelta = 0;
    for (const item of editorItems) {
      const current = resolveGrindingPlanningBoardResource(item, allocation);
      const target = resourceChoice === 'restore'
        ? item.originalResourceCd
        : resourceChoice === 'unchanged' ? current : resourceChoice;
      if (item.requiredMinutesKnown && item.requiredMinutes != null) {
        if (current === resource) delta -= item.requiredMinutes;
        if (target === resource) delta += item.requiredMinutes;
      } else {
        if (current === resource) unknownDelta -= 1;
        if (target === resource) unknownDelta += 1;
      }
    }
    const known = Math.max(0, (base ?? 0) + delta);
    const unknown = Math.max(0, (baseUnknown ?? 0) + unknownDelta);
    return formatPlanningBoardLoadSummary(known, unknown);
  };

  return (
    <main className="min-h-0 w-full shrink-0 overflow-hidden bg-slate-950 px-2 py-2 text-white sm:px-3">
      <PlanningBoardToolbar
        category={category}
        view={view}
        status={status}
        allocation={allocation}
        selectedCount={toolbarSelectedItems.length}
        scopeDisabled={writeQueue.pending}
        bulkDisabled={allocation === 'original' || toolbarSelectedItems.length === 0 || !bulkReady || writeBlocked}
        registeredCount={registeredFseibans.length}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCategoryChange={(value) => { if (!writeQueue.pending) setCategory(value); }}
        onViewChange={setView}
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
      {boardQuery.isError ? <p className="p-5 text-sm text-rose-200">一覧を読み込めませんでした。</p> : null}
      {data && view === 'seiban' && focusedFseiban && focusItems.length > 0 ? (
        <div className="mt-2">
          <PlanningBoardFocusView
            fseiban={focusedFseiban}
            machineName={machineNames.get(focusedFseiban) ?? null}
            items={focusItems}
            allocation={allocation}
            selectedItemIds={selectedItemIds}
            onBack={returnFromFocus}
            onToggleAll={toggleFocusAll}
            onToggleItem={toggleItem}
            onResourceClick={openEditorForItem}
            onRankChange={changeRank}
            disabled={interactionLocked}
            rankDisabled={rankDisabled}
            bulkDisabled={!bulkReady}
          />
        </div>
      ) : data && view === 'seiban' ? (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-4">
          {registeredFseibans.filter((fseiban) => activeFseibans.has(fseiban)).map((fseiban) => {
            const group = itemsBySeiban.get(fseiban) ?? [];
            if (group.length === 0) return null;
            const actions = paneActionsBySeiban.get(fseiban);
            if (!actions) return null;
            return (
              <PlanningBoardSeibanPane
                key={fseiban}
                fseiban={fseiban}
                machineName={machineNames.get(fseiban) ?? null}
                items={sortedItemsBySeiban.get(fseiban) ?? group}
                allocation={allocation}
                selectedItemIds={selectedItemIds}
                isOpen={openFseibans.has(fseiban)}
                isFocused={false}
                onToggleOpen={actions.onToggleOpen}
                onFocus={actions.onFocus}
                onToggleAll={actions.onToggleAll}
                onToggleItem={toggleItem}
                onResourceClick={openEditorForItem}
                onRankChange={changeRank}
                disabled={interactionLocked}
                rankDisabled={rankDisabled}
                bulkDisabled={!bulkReady}
              />
            );
          })}
        </div>
      ) : data ? (
        <div className="mt-2">
          <PlanningBoardResourceView
            key={`${data.siteKey}:${category}`}
            preferenceScope={`${data.siteKey}:${category}`}
            items={visibleItems}
            seibanOrder={registeredFseibans}
            resources={data.resources}
            resourceNameMap={resourcesQuery.data?.resourceNameMap ?? {}}
            allocation={allocation}
            selectedItemIds={selectedItemIds}
            onToggleItem={toggleItem}
            onResourceClick={openEditorForItem}
            onResourceDrop={moveResourceByDrag}
            onResourceReorder={reorderResourceByDrag}
            onRankChange={changeRank}
            specialDueMode={specialDueMode}
            onSpecialDueClick={updateSpecialDue}
            nowMs={nowMs}
            disabled={interactionLocked}
            resourceDragDisabled={resourceDragDisabled}
            rankDisabled={rankDisabled}
          />
        </div>
      ) : null}
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
      {dueDetailFseiban ? (
        <div
          className="fixed inset-0 z-40 bg-black/45"
          role="presentation"
          onClick={closeDueDetail}
        />
      ) : null}
      <div className="fixed inset-y-0 right-0 z-50 flex max-w-full">
        <LeaderBoardDueAssistPanel
          isOpen={dueDetailFseiban !== null}
          selectedFseiban={dueDetailFseiban}
          detail={dueDetail}
          loading={dueDetailQuery.isLoading}
          error={dueDetailQuery.isError}
          dueUpdatePending={pendingDueScope?.fseiban === dueDetailFseiban}
          readOnly={allocation === 'original' || dueConflict || (dueDetailFseiban != null && hasPendingSeiban(dueDetailFseiban)) || pendingDueScope?.fseiban === dueDetailFseiban}
          conflict={dueConflict}
          errorMessage={dueError}
          onRefresh={() => void refreshDueDetail()}
          onClose={closeDueDetail}
          onOpenSeibanDueDatePicker={() => openDuePicker({ kind: 'seiban' }, dueDetail?.dueDate ?? null)}
          onOpenProcessingDueDatePicker={(processingType, currentDueDate) => openDuePicker({ kind: 'processing', processingType }, currentDueDate)}
        />
      </div>
      <KioskDatePickerModal
        isOpen={duePickerState !== null}
        value={duePickerState?.value ?? ''}
        onCancel={() => setDuePickerState(null)}
        onCommit={(next) => void commitDueDate(next)}
        overlayZIndex={60}
      />
      <Dialog isOpen={editorOpen} onClose={() => setEditorOpen(false)} title="一括変更" size="lg">
        <div className="mt-4 space-y-4">
          <p className="text-sm font-semibold text-slate-800">対象 {editorItems.length}件</p>
          {editorError ? <p className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800" role="alert">{editorError}</p> : null}
          {editorConflict ? <Button type="button" variant="secondary" onClick={() => void refreshAfterConflict()}>最新状態を取得して閉じる</Button> : null}
          {allocation === 'original' ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">元データ表示中は変更できません。別割当に切り替えてください。</p> : null}
          <fieldset disabled={allocation === 'original' || writeBlocked}>
            <legend className="text-sm font-semibold text-slate-800">資源CD</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={`min-h-11 rounded-md border px-3 text-sm ${resourceChoice === 'unchanged' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setResourceChoice('unchanged')}>変更なし</button>
              <button type="button" className={`min-h-11 rounded-md border px-3 text-sm ${resourceChoice === 'restore' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setResourceChoice('restore')}>元に戻す</button>
              {editorResources.map((resource) => {
                const summary = editorSnapshot?.load.find((entry) => entry.resourceCd === resource);
                return (
                  <button
                    key={resource}
                    type="button"
                    aria-label={`資源CD ${resource}へ変更`}
                    className={`min-h-11 rounded-md border px-2 text-left font-mono text-sm ${resourceChoice === resource ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`}
                    onClick={() => setResourceChoice(resource)}
                  >
                    <span className="block">{resource}</span>
                    <span className="block text-[10px] font-sans opacity-75">{formatPlanningBoardResourceLoad(summary, allocation)}</span>
                  </button>
                );
              })}
            </div>
            {resourceChoice !== 'unchanged' ? (
              <p className="mt-2 text-xs text-slate-600">
                {resourceChoice === 'restore'
                  ? `復帰後負荷: ${[...new Set(editorItems.map((item) => item.originalResourceCd).filter((resource): resource is string => Boolean(resource)))].map((resource) => `${resource} ${projectedLoad(resource)}`).join(' / ') || '0分'}`
                  : `移動後負荷: ${projectedLoad(resourceChoice)}`}
              </p>
            ) : null}
          </fieldset>
          <fieldset disabled={allocation === 'original' || writeBlocked}>
            <legend className="text-sm font-semibold text-slate-800">日付</legend>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <button type="button" className={`min-h-11 rounded-md border px-3 ${dueMode === 'none' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setDueMode('none')}>変更なし</button>
              <button type="button" className={`min-h-11 rounded-md border px-3 ${dueMode === 'restore' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setDueMode('restore')}>元に戻す</button>
              <button type="button" className={`min-h-11 rounded-md border px-3 ${dueMode === 'date' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setDueMode('date')}>指定日</button>
              <input type="date" value={dueDate} onChange={(event) => { setDueDate(event.target.value); setDueMode('date'); }} className="min-h-11 rounded-md border border-slate-300 px-2" />
              <button type="button" className={`min-h-11 rounded-md border px-3 ${dueMode === 'offsetDays' ? 'border-emerald-600 bg-emerald-100 text-emerald-950' : 'border-slate-300'}`} onClick={() => setDueMode('offsetDays')}>+暦日</button>
              <input type="number" min="1" step="1" value={offsetDays} onChange={(event) => { setOffsetDays(event.target.value); setDueMode('offsetDays'); }} className="min-h-11 w-20 rounded-md border border-slate-300 px-2" aria-label="加算日数" />
            </div>
          </fieldset>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {editorItems.slice(0, 4).map((item) => <div key={item.itemId}>{item.fseiban} · {item.fhinmei || item.fhincd} / {previewDue(item)}</div>)}
            {editorItems.length > 4 ? <div>ほか {editorItems.length - 4}件</div> : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>キャンセル</Button>
            <Button type="button" variant="primary" disabled={allocation === 'original' || writeBlocked || (resourceChoice === 'unchanged' && dueMode === 'none')} onClick={() => void applyEditor()}>{writeBlocked ? '適用中…' : '適用'}</Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
