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
import { LeaderBoardDueAssistPanel } from '../../features/kiosk/leaderOrderBoard/LeaderBoardDueAssistPanel';
import { normalizeDueDateInput } from '../../features/kiosk/productionSchedule/dueManagement';

import type { PlanningBoardAllocation, PlanningBoardStatus } from '../../features/kiosk/grindingPlanningBoard/types';
import type {
  GrindingPlanningBoardDueScope,
  GrindingPlanningBoardDueScopeSnapshot,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardOverrideItemRequest,
  GrindingPlanningBoardRankResponse,
  GrindingPlanningBoardResourceOrderPlacement,
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardDueRequest,
  GrindingPlanningBoardSpecialDueKind
} from '@raspi-system/shared-types';

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

type RankDisplayState = {
  rank: number | null;
  itemRevision: string;
  version: number;
};

type PendingRankOverride = RankDisplayState & {
  scopeKey: string;
  requestId: number;
  staleStates: RankDisplayState[];
  restoreState: RankDisplayState;
  phase: 'saving' | 'awaitingSync';
};

type PendingOrder = {
  order: string[];
  baseSourceRevision: string;
  responseSourceRevision: string | null;
};

type PendingOverrideItem = {
  item: GrindingPlanningBoardItem;
  baseSourceRevision: string;
  baseItemRevision: string;
  baseVersion: number;
  responseSourceRevision: string | null;
  responseItemRevision: string | null;
  responseVersion: number | null;
  expectedSpecialDueKind?: GrindingPlanningBoardSpecialDueKind | null;
};

type PendingDueScopeUpdate = {
  fseiban: string;
  scope: GrindingPlanningBoardDueScope;
  dueDate: string;
  baseScopeRevision: string;
  responseScopeRevision: string | null;
};

function dueScopeKey(scope: GrindingPlanningBoardDueScope): string {
  return scope.kind === 'seiban' ? 'seiban' : `processing:${scope.processingType}`;
}

function applyOptimisticOverride(
  item: GrindingPlanningBoardItem,
  request: GrindingPlanningBoardOverrideItemRequest
): GrindingPlanningBoardItem {
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
    specialDue: request.specialDue === null ? null : item.specialDue
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
  const [registeredFseibans, setRegisteredFseibans] = useState<string[]>([]);
  const [activeFseibans, setActiveFseibans] = useState<ReadonlySet<string>>(new Set());
  const [showCompletedCandidates, setShowCompletedCandidates] = useState(false);
  const [selectedItemIdsByCategory, setSelectedItemIdsByCategory] = useState<Record<string, ReadonlySet<string>>>({});
  const [orderInitialized, setOrderInitialized] = useState(false);
  const [activeInitialized, setActiveInitialized] = useState(false);
  const [openInitialized, setOpenInitialized] = useState(false);
  const pendingOrderRef = useRef<PendingOrder | null>(null);
  const latestOrderSourceRevisionRef = useRef<string | null>(null);
  const staleOrderSourceRevisionsRef = useRef<Set<string>>(new Set());
  const orderRequestPendingRef = useRef(false);
  const dueRequestPendingRef = useRef(false);
  const dueDetailIdentityRef = useRef<string | null>(null);
  const [editorSnapshot, setEditorSnapshot] = useState<{
    items: GrindingPlanningBoardItem[];
    sourceRevision: string;
    resources: string[];
    load: GrindingPlanningBoardResponse['load'];
  } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [resourceChoice, setResourceChoice] = useState<ResourceChoice>('unchanged');
  const [dueMode, setDueMode] = useState<DueMode>('none');
  const [dueDate, setDueDate] = useState(() => addUtcDays(todayJst(), 3));
  const [offsetDays, setOffsetDays] = useState('1');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorConflict, setEditorConflict] = useState(false);
  const [orderConflict, setOrderConflict] = useState(false);
  const [orderRegistrationError, setOrderRegistrationError] = useState<string | null>(null);
  const [rankConflict, setRankConflict] = useState(false);
  const [orderSaving, setOrderSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>('success');
  const [specialDueMode, setSpecialDueMode] = useState<GrindingPlanningBoardSpecialDueKind | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [dueDetailFseiban, setDueDetailFseiban] = useState<string | null>(null);
  const [dueDetailTargetFseiban, setDueDetailTargetFseiban] = useState<string | null>(null);
  const [duePickerState, setDuePickerState] = useState<DuePickerState | null>(null);
  const [dueConflict, setDueConflict] = useState(false);
  const [dueError, setDueError] = useState<string | null>(null);
  const [pendingRankOverrides, setPendingRankOverrides] = useState<Record<string, PendingRankOverride>>({});
  const [pendingOverrideItems, setPendingOverrideItems] = useState<Record<string, PendingOverrideItem>>({});
  const [pendingDueScope, setPendingDueScope] = useState<PendingDueScopeUpdate | null>(null);
  const [resourceOrderSaving, setResourceOrderSaving] = useState(false);
  const rankRequestIdRef = useRef(0);
  const resourceDragSavePendingRef = useRef(false);
  const resourceOrderSavePendingRef = useRef(false);
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
  });
  const resourcesQuery = useKioskProductionScheduleResources({ pauseRefetch: true });
  const dueDetailQuery = useKioskGrindingPlanningBoardDueDetail(dueDetailFseiban);
  const { mutateAsync: updateOverridesAsync, isPending: overridesPending } = useUpdateKioskGrindingPlanningBoardOverrides();
  const updateDueScope = useUpdateKioskGrindingPlanningBoardDueScope();
  const { mutateAsync: updateRankAsync } = useUpdateKioskGrindingPlanningBoardRank();
  const { mutateAsync: updateResourceOrderAsync } = useUpdateKioskGrindingPlanningBoardResourceOrder();
  const updateOrder = useUpdateKioskGrindingPlanningBoardSeibanOrder();

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
  const rankMutationPending = Object.values(pendingRankOverrides).some(
    (pending) => pending.scopeKey === rankScopeKey && pending.phase === 'saving'
  );
  const rankDisabled = useCallback((item: GrindingPlanningBoardItem) => (
    !rankMutationReady ||
    rankMutationPending ||
    resourceOrderSaving ||
    (pendingOverrideItems[item.itemId] != null && pendingOverrideItems[item.itemId].responseItemRevision == null)
  ), [pendingOverrideItems, rankMutationPending, rankMutationReady, resourceOrderSaving]);

  useEffect(() => {
    setPendingRankOverrides((current) => {
      let changed = false;
      const next: Record<string, PendingRankOverride> = {};
      for (const [itemId, pending] of Object.entries(current)) {
        if (pending.scopeKey !== rankScopeKey) {
          changed = true;
          continue;
        }
        const currentItem = data?.items.find((item) => item.itemId === itemId);
        const isAuthoritative = currentItem?.itemRevision === pending.itemRevision && currentItem.version === pending.version;
        const isStale = currentItem != null && pending.staleStates.some(
          (state) => state.itemRevision === currentItem.itemRevision && state.version === currentItem.version
        );
        if (pending.phase === 'awaitingSync' && currentItem != null && (isAuthoritative || !isStale)) {
          changed = true;
          continue;
        }
        next[itemId] = pending;
      }
      return changed ? next : current;
    });
  }, [data, pendingRankOverrides, rankScopeKey]);

  useEffect(() => {
    if (!data || boardQuery.isPlaceholderData) return;
    setPendingOverrideItems((current) => {
      let changed = false;
      const next: Record<string, PendingOverrideItem> = {};
      for (const [itemId, pending] of Object.entries(current)) {
        const currentItem = data.items.find((item) => item.itemId === itemId);
        const baseMatches = currentItem != null && currentItem.itemRevision === pending.baseItemRevision && currentItem.version === pending.baseVersion;
        const responseMatches = currentItem != null && pending.responseItemRevision != null && currentItem.itemRevision === pending.responseItemRevision && currentItem.version === pending.responseVersion;
        const specialDueMatches = pending.expectedSpecialDueKind === undefined || (currentItem?.specialDue?.kind ?? null) === pending.expectedSpecialDueKind;
        const itemMatches = currentItem == null || (
          currentItem.effectiveResourceCd === pending.item.effectiveResourceCd &&
          currentItem.effectiveDueDate === pending.item.effectiveDueDate &&
          currentItem.alternateRank === pending.item.alternateRank &&
          specialDueMatches
        );
        const otherAuthoritativeItem = pending.responseItemRevision != null && currentItem != null && !baseMatches && !responseMatches;
        if (responseMatches && itemMatches || otherAuthoritativeItem) {
          changed = true;
          continue;
        }
        next[itemId] = pending;
      }
      return changed ? next : current;
    });
  }, [boardQuery.isPlaceholderData, data, pendingOverrideItems]);

  const displayItems = useMemo(() => {
    if (!data) return [];
    return data.items.map((item) => {
      const overrideItem = pendingOverrideItems[item.itemId]?.item;
      const baseItem = overrideItem ?? item;
      const pendingRank = pendingRankOverrides[item.itemId];
      return pendingRank && pendingRank.scopeKey === rankScopeKey
        ? { ...baseItem, alternateRank: pendingRank.rank, itemRevision: pendingRank.itemRevision, version: pendingRank.version }
        : baseItem;
    });
  }, [data, pendingOverrideItems, pendingRankOverrides, rankScopeKey]);
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
    if (!data) return;
    const revisionIsStale = staleOrderSourceRevisionsRef.current.has(data.sourceRevision);
    const authoritative = !boardQuery.isPlaceholderData && !revisionIsStale;
    const siteChanged = boardSiteKeyRef.current != null && boardSiteKeyRef.current !== data.siteKey;
    const serverOrder = data.registeredFseibans;
    const pending = pendingOrderRef.current;
    if (siteChanged) {
      boardSiteKeyRef.current = data.siteKey;
      registeredServerFseibansRef.current = new Set(serverOrder);
      setRegisteredFseibans(serverOrder);
      setOrderInitialized(true);
      setActiveFseibans(new Set(data.seibanOrder));
      setActiveInitialized(true);
      setOpenFseibans(new Set(data.seibanOrder.length > 0 ? data.seibanOrder : serverOrder));
      setOpenInitialized(true);
      pendingOrderRef.current = null;
      setOrderSaving(false);
      setDueDetailTargetFseiban((current) => current && serverOrder.includes(current) ? current : serverOrder[0] ?? null);
      return;
    }
    if (boardSiteKeyRef.current == null) boardSiteKeyRef.current = data.siteKey;
    if (!boardQuery.isPlaceholderData && !revisionIsStale) {
      if (!pending || pending.responseSourceRevision == null || data.sourceRevision !== pending.baseSourceRevision) {
        if (latestOrderSourceRevisionRef.current != null && latestOrderSourceRevisionRef.current !== data.sourceRevision) {
          staleOrderSourceRevisionsRef.current.add(latestOrderSourceRevisionRef.current);
        }
        latestOrderSourceRevisionRef.current = data.sourceRevision;
      }
    }
    if (!orderInitialized) {
      setRegisteredFseibans(serverOrder);
      setOrderInitialized(true);
    } else if (pending) {
      const authoritative = !boardQuery.isPlaceholderData;
      const orderMatches = pending.order.length === serverOrder.length && pending.order.every((value, index) => serverOrder[index] === value);
      const responseMatches = authoritative && pending.responseSourceRevision != null && data.sourceRevision === pending.responseSourceRevision && orderMatches;
      const newerAuthoritativeData = authoritative && !revisionIsStale && pending.responseSourceRevision != null && data.sourceRevision !== pending.baseSourceRevision;
      if (!orderSaving && (responseMatches || newerAuthoritativeData)) {
        pendingOrderRef.current = null;
        if (newerAuthoritativeData && !responseMatches) setRegisteredFseibans(serverOrder);
      }
    } else if (!orderSaving && !boardQuery.isPlaceholderData && !revisionIsStale) {
      setRegisteredFseibans(serverOrder);
    }
    if (!activeInitialized) {
      setActiveFseibans(new Set(data.seibanOrder));
      setActiveInitialized(true);
    }
    setDueDetailTargetFseiban((current) => current && serverOrder.includes(current) ? current : serverOrder[0] ?? null);
    if (!openInitialized) {
      const initialOpenFseibans = data.seibanOrder.length > 0 ? data.seibanOrder : serverOrder;
      if (initialOpenFseibans.length > 0) {
        setOpenFseibans(new Set(initialOpenFseibans));
        setOpenInitialized(true);
      }
    }
    const orderSettled = authoritative && !orderSaving && (
      pending == null ||
      (pending.responseSourceRevision != null && (
        pending.responseSourceRevision === data.sourceRevision || data.sourceRevision !== pending.baseSourceRevision
      ))
    );
    if (orderSettled) {
      const previousServerOrder = registeredServerFseibansRef.current ?? new Set<string>();
      const newlyRegistered = serverOrder.filter((value) => !previousServerOrder.has(value));
      if (newlyRegistered.length > 0) {
        setActiveFseibans((current) => new Set([...current, ...newlyRegistered]));
        setOpenFseibans((current) => new Set([...current, ...newlyRegistered]));
      }
      registeredServerFseibansRef.current = new Set(serverOrder);
    }
  }, [activeInitialized, boardQuery.isPlaceholderData, data, openInitialized, orderInitialized, orderSaving]);

  useEffect(() => {
    setFocusedFseiban(null);
  }, [category, status, view]);

  useEffect(() => {
    if (!scopeReady) setFocusedFseiban(null);
  }, [scopeReady]);

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
  const resourceDragDisabled = resourceOrderSaving || rankMutationPending || overridesPending || Object.values(pendingOverrideItems).some(
    (pending) => pending.responseItemRevision == null
  );

  const handleError = useCallback((error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 409) {
      setRankConflict(true);
      notify('表示中のデータが更新されています。最新状態を取得してください。', 'error');
      return;
    }
    notify('保存できませんでした。時間をおいて再試行してください。', 'error');
  }, [notify]);

  const toggleItem = useCallback((item: GrindingPlanningBoardItem, selected: boolean) => {
    const pendingOverride = pendingOverrideItems[item.itemId];
    if (!scopeReady || item.isCompleted || (pendingOverride != null && pendingOverride.responseItemRevision == null)) return;
    setSelectedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      if (selected) next.add(item.itemId); else next.delete(item.itemId);
      return { ...current, [category]: next };
    });
  }, [category, pendingOverrideItems, scopeReady]);

  const toggleAll = useCallback((items: readonly GrindingPlanningBoardItem[], selected: boolean) => {
    if (!bulkReady) return;
    setSelectedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      for (const item of items) {
        const pendingOverride = pendingOverrideItems[item.itemId];
        if (item.isCompleted || (pendingOverride != null && pendingOverride.responseItemRevision == null)) continue;
        if (selected) next.add(item.itemId); else next.delete(item.itemId);
      }
      return { ...current, [category]: next };
    });
  }, [bulkReady, category, pendingOverrideItems]);

  const updateSpecialDue = useCallback(async (item: GrindingPlanningBoardItem) => {
    if (
      !data ||
      !scopeReady ||
      !rankMutationReady ||
      allocation === 'original' ||
      specialDueMode == null ||
      item.isCompleted ||
      overridesPending ||
      resourceDragSavePendingRef.current ||
      resourceOrderSavePendingRef.current ||
      rankMutationPending ||
      (pendingOverrideItems[item.itemId] != null && pendingOverrideItems[item.itemId].responseItemRevision == null)
    ) return;
    const nextSpecialDue = item.specialDue?.kind === specialDueMode ? null : specialDueMode;
    const request: GrindingPlanningBoardOverrideItemRequest = {
      itemId: item.itemId,
      itemRevision: item.itemRevision,
      overrideVersion: item.version,
      specialDue: nextSpecialDue
    };
    const baseSourceRevision = data.sourceRevision;
    setPendingOverrideItems((current) => ({
      ...current,
      [item.itemId]: {
        item: applyOptimisticOverride(item, request),
        baseSourceRevision,
        baseItemRevision: item.itemRevision,
        baseVersion: item.version,
        responseSourceRevision: null,
        responseItemRevision: null,
        responseVersion: null,
        expectedSpecialDueKind: nextSpecialDue
      }
    }));
    notify(nextSpecialDue == null ? '特別納期を解除中…' : `${nextSpecialDue === 'today' ? '今日中' : '朝まで'}を保存中…`, 'processing');
    try {
      const result = await updateOverridesAsync({ sourceRevision: baseSourceRevision, items: [request] });
      setPendingOverrideItems((current) => {
        const pending = current[item.itemId];
        if (!pending || pending.baseSourceRevision !== baseSourceRevision) return current;
        const responseItem = (result.items ?? []).find((candidate) => candidate.itemId === item.itemId);
        return {
          ...current,
          [item.itemId]: {
            ...pending,
            item: responseItem ?? pending.item,
            responseSourceRevision: result.sourceRevision,
            responseItemRevision: responseItem?.itemRevision ?? null,
            responseVersion: responseItem?.version ?? null
          }
        };
      });
      notify(nextSpecialDue == null ? '特別納期を解除しました。' : `${nextSpecialDue === 'today' ? '今日中' : '朝まで'}を設定しました。`, 'success');
    } catch (error) {
      setPendingOverrideItems((current) => {
        const pending = current[item.itemId];
        if (!pending || pending.baseSourceRevision !== baseSourceRevision) return current;
        const next = { ...current };
        delete next[item.itemId];
        return next;
      });
      handleError(error);
    }
  }, [allocation, data, handleError, notify, pendingOverrideItems, rankMutationPending, rankMutationReady, scopeReady, specialDueMode, updateOverridesAsync, overridesPending]);

  const openEditor = useCallback((items: readonly GrindingPlanningBoardItem[]) => {
    if (!scopeReady || items.some((item) => pendingOverrideItems[item.itemId] != null && pendingOverrideItems[item.itemId].responseItemRevision == null)) return;
    const target = items.filter((item) => !item.isCompleted);
    if (target.length === 0) return;
    if (!data) return;
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
  }, [allocation, clearFeedback, data, pendingOverrideItems, scopeReady]);

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
    if (!dueDetailFseiban || !detail || allocation === 'original' || dueConflict || pendingDueScope?.fseiban === dueDetailFseiban) return;
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
  }, [allocation, dueConflict, dueDetailFseiban, dueDetailQuery.data, pendingDueScope]);

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
      setDueError(null);
      notify('最新状態を取得しました。対象を選び直して再適用してください。', 'success');
    } catch {
      setDueError('最新状態を取得できませんでした。再試行してください。');
      notify('最新状態を取得できませんでした。再試行してください。', 'error');
    }
  }, [boardQuery, dueDetailQuery, notify]);

  const commitDueDate = useCallback(async (nextDueDate: string) => {
    const current = duePickerState;
    if (!current || allocation === 'original' || dueRequestPendingRef.current) return;
    dueRequestPendingRef.current = true;
    const pendingUpdate: PendingDueScopeUpdate = {
      fseiban: current.fseiban,
      scope: current.scope,
      dueDate: nextDueDate,
      baseScopeRevision: current.snapshot.scopeRevision,
      responseScopeRevision: null
    };
    setPendingDueScope(pendingUpdate);
    notify(`${current.fseiban}の納期を保存中…`, 'processing');
    try {
      const result = await updateDueScope.mutateAsync({
        fseiban: current.fseiban,
        payload: {
          ...current.snapshot,
          scope: current.scope,
          dueDate: nextDueDate
        }
      });
      setPendingDueScope((pending) => pending?.fseiban === pendingUpdate.fseiban && dueScopeKey(pending.scope) === dueScopeKey(pendingUpdate.scope)
        ? { ...pending, responseScopeRevision: result.scopeRevision }
        : pending);
      if (dueDetailIdentityRef.current !== current.fseiban) return;
      setDuePickerState(null);
      setDueConflict(false);
      setDueError(null);
      notify(`${current.fseiban}の納期を更新しました。`, 'success');
    } catch (error) {
      setPendingDueScope((pending) => pending?.fseiban === pendingUpdate.fseiban && dueScopeKey(pending.scope) === dueScopeKey(pendingUpdate.scope) ? null : pending);
      if (dueDetailIdentityRef.current !== current.fseiban) return;
      setDuePickerState(null);
      if (isAxiosError(error) && error.response?.status === 409) {
        setDueConflict(true);
        setDueError('表示中の納期が更新されています。最新状態を取得してから再適用してください。');
        notify('表示中の納期が更新されています。最新状態を取得してください。', 'error');
      } else {
        setDueError('納期を保存できませんでした。入力内容と通信状態を確認してください。');
        notify('納期を保存できませんでした。入力内容と通信状態を確認してください。', 'error');
      }
    } finally {
      dueRequestPendingRef.current = false;
    }
  }, [allocation, duePickerState, notify, updateDueScope]);

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
    const pendingItems = new Map(editorItems.map((item) => [item.itemId, item]));
    setPendingOverrideItems((current) => {
      const next = { ...current };
      for (const request of items) {
        const item = pendingItems.get(request.itemId);
        if (!item) continue;
        next[request.itemId] = {
          item: applyOptimisticOverride(item, request),
          baseSourceRevision: editorSnapshot.sourceRevision,
          baseItemRevision: item.itemRevision,
          baseVersion: item.version,
          responseSourceRevision: null,
          responseItemRevision: null,
          responseVersion: null
        };
      }
      return next;
    });
    notify(`${items.length}件を更新中…`, 'processing');
    try {
      const result = await updateOverridesAsync({ sourceRevision: editorSnapshot.sourceRevision, items });
      setPendingOverrideItems((current) => {
        const next = { ...current };
        for (const request of items) {
          const pending = next[request.itemId];
          const responseItem = (result.items ?? []).find((item) => item.itemId === request.itemId);
          if (pending?.baseSourceRevision === editorSnapshot.sourceRevision) {
            next[request.itemId] = {
              ...pending,
              item: responseItem ?? pending.item,
              responseSourceRevision: result.sourceRevision,
              responseItemRevision: responseItem?.itemRevision ?? null,
              responseVersion: responseItem?.version ?? null
            };
          }
        }
        return next;
      });
      setEditorOpen(false);
      notify(`${items.length}件を更新しました。`, 'success');
    } catch (error) {
      setPendingOverrideItems((current) => {
        const next = { ...current };
        for (const request of items) {
          if (next[request.itemId]?.baseSourceRevision === editorSnapshot.sourceRevision) delete next[request.itemId];
        }
        return next;
      });
      if (isAxiosError(error) && error.response?.status === 409) {
        setEditorConflict(true);
        setEditorError('表示中のデータが更新されています。最新状態を取得してから対象を選び直してください。');
        notify('表示中のデータが更新されています。最新状態を取得してください。', 'error');
      } else if (isAxiosError(error) && typeof error.response?.data?.message === 'string') {
        setEditorError(`保存できませんでした: ${error.response.data.message}`);
        notify(`保存できませんでした: ${error.response.data.message}`, 'error');
      } else {
        setEditorError('保存できませんでした。入力内容とネットワーク接続を確認してください。');
        notify('保存できませんでした。入力内容とネットワーク接続を確認してください。', 'error');
      }
    }
  };

  const moveResourceByDrag = useCallback(async (item: GrindingPlanningBoardItem, targetResource: string) => {
    const pendingOverride = pendingOverrideItems[item.itemId];
    const currentResource = resolveGrindingPlanningBoardResource(item, allocation);
    if (
      !data ||
      !scopeReady ||
      !rankMutationReady ||
      !sourceRevision ||
      allocation === 'original' ||
      item.isCompleted ||
      !data.resources.includes(targetResource) ||
      currentResource === targetResource ||
      overridesPending ||
      resourceDragSavePendingRef.current ||
      resourceOrderSavePendingRef.current ||
      rankMutationPending ||
      (pendingOverride != null && pendingOverride.responseItemRevision == null)
    ) return;

    resourceDragSavePendingRef.current = true;
    const request: GrindingPlanningBoardOverrideItemRequest = {
      itemId: item.itemId,
      itemRevision: item.itemRevision,
      overrideVersion: item.version,
      resourceCd: targetResource
    };
    const baseSourceRevision = data.sourceRevision;
    setPendingOverrideItems((current) => ({
      ...current,
      [item.itemId]: {
        item: applyOptimisticOverride(item, request),
        baseSourceRevision,
        baseItemRevision: item.itemRevision,
        baseVersion: item.version,
        responseSourceRevision: null,
        responseItemRevision: null,
        responseVersion: null
      }
    }));
    notify('資源CDを保存中…', 'processing');
    try {
      const result = await updateOverridesAsync({ sourceRevision: baseSourceRevision, items: [request] });
      setPendingOverrideItems((current) => {
        const pending = current[item.itemId];
        if (!pending || pending.baseSourceRevision !== baseSourceRevision) return current;
        const responseItem = (result.items ?? []).find((candidate) => candidate.itemId === item.itemId);
        return {
          ...current,
          [item.itemId]: {
            ...pending,
            item: responseItem ?? pending.item,
            responseSourceRevision: result.sourceRevision,
            responseItemRevision: responseItem?.itemRevision ?? null,
            responseVersion: responseItem?.version ?? null
          }
        };
      });
      notify('資源CDを' + targetResource + 'へ変更しました。', 'success');
    } catch (error) {
      setPendingOverrideItems((current) => {
        const pending = current[item.itemId];
        if (!pending || pending.baseSourceRevision !== baseSourceRevision) return current;
        const next = { ...current };
        delete next[item.itemId];
        return next;
      });
      handleError(error);
    } finally {
      resourceDragSavePendingRef.current = false;
    }
  }, [allocation, data, handleError, notify, pendingOverrideItems, rankMutationPending, rankMutationReady, scopeReady, sourceRevision, updateOverridesAsync, overridesPending]);

  const reorderResourceByDrag = useCallback(async (
    item: GrindingPlanningBoardItem,
    targetItem: GrindingPlanningBoardItem,
    placement: GrindingPlanningBoardResourceOrderPlacement
  ) => {
    const currentResource = resolveGrindingPlanningBoardResource(item, allocation);
    if (
      !data ||
      !scopeReady ||
      !rankMutationReady ||
      !sourceRevision ||
      allocation === 'original' ||
      item.isCompleted ||
      targetItem.isCompleted ||
      currentResource == null ||
      currentResource !== resolveGrindingPlanningBoardResource(targetItem, allocation) ||
      (item.specialDue?.expiresAt ?? null) !== (targetItem.specialDue?.expiresAt ?? null) ||
      !data.resources.includes(currentResource) ||
      overridesPending ||
      resourceDragSavePendingRef.current ||
      resourceOrderSavePendingRef.current ||
      rankMutationPending ||
      Object.values(pendingOverrideItems).some((pending) => pending.responseItemRevision == null)
    ) return;

    resourceOrderSavePendingRef.current = true;
    setResourceOrderSaving(true);
    setRankConflict(false);
    notify('資源CD内の順序を保存中…', 'processing');
    const requestSourceRevision = data.sourceRevision;
    const requestId = ++rankRequestIdRef.current;
    const visiblePaneItems = sortGrindingPlanningBoardItems(
      visibleItems.filter((candidate) => resolveGrindingPlanningBoardResource(candidate, allocation) === currentResource),
      registeredFseibans,
      'resource',
      allocation
    );
    const sourceIndex = visiblePaneItems.findIndex((candidate) => candidate.itemId === item.itemId);
    const targetIndex = visiblePaneItems.findIndex((candidate) => candidate.itemId === targetItem.itemId);
    if (sourceIndex < 0 || targetIndex < 0) {
      resourceOrderSavePendingRef.current = false;
      setResourceOrderSaving(false);
      return;
    }
    const optimisticPaneItems = [...visiblePaneItems];
    const [optimisticMoved] = optimisticPaneItems.splice(sourceIndex, 1);
    const optimisticInsertionIndex = optimisticPaneItems.findIndex((candidate) => candidate.itemId === targetItem.itemId) + (placement === 'after' ? 1 : 0);
    optimisticPaneItems.splice(optimisticInsertionIndex, 0, optimisticMoved);
    setPendingRankOverrides((current) => {
      const next = { ...current };
      let bandRank = 0;
      const specialDueBand = item.specialDue?.expiresAt ?? null;
      for (const optimisticItem of optimisticPaneItems) {
        if ((optimisticItem.specialDue?.expiresAt ?? null) !== specialDueBand) continue;
        bandRank += 1;
        const previous = current[optimisticItem.itemId];
        const restoreState: RankDisplayState = previous?.phase === 'awaitingSync'
          ? { rank: previous.rank, itemRevision: previous.itemRevision, version: previous.version }
          : { rank: optimisticItem.alternateRank, itemRevision: optimisticItem.itemRevision, version: optimisticItem.version };
        next[optimisticItem.itemId] = {
          scopeKey: rankScopeKey,
          requestId,
          staleStates: [...(previous?.staleStates ?? []), restoreState],
          restoreState,
          itemRevision: optimisticItem.itemRevision,
          version: optimisticItem.version,
          rank: bandRank,
          phase: 'saving'
        };
      }
      return next;
    });
    try {
      const result = await updateResourceOrderAsync({
        sourceRevision: requestSourceRevision,
        itemId: item.itemId,
        itemRevision: item.itemRevision,
        overrideVersion: item.version,
        targetItemId: targetItem.itemId,
        targetItemRevision: targetItem.itemRevision,
        targetOverrideVersion: targetItem.version,
        placement
      });
      setPendingRankOverrides((current) => {
        const next = { ...current };
        for (const responseItem of result.items) {
          const baseItem = displayItems.find((candidate) => candidate.itemId === responseItem.itemId);
          const pending = current[responseItem.itemId];
          if (!baseItem || !pending || pending.requestId !== requestId) continue;
          next[responseItem.itemId] = {
            ...pending,
            itemRevision: responseItem.itemRevision,
            version: responseItem.version,
            rank: responseItem.alternateRank,
            phase: 'awaitingSync'
          };
        }
        return next;
      });
      notify('資源CD内の順序を保存しました。', 'success');
    } catch (error) {
      setPendingRankOverrides((current) => {
        const next = { ...current };
        for (const [itemId, pending] of Object.entries(current)) {
          if (pending.requestId !== requestId || pending.scopeKey !== rankScopeKey) continue;
          next[itemId] = {
            ...pending,
            rank: pending.restoreState.rank,
            itemRevision: pending.restoreState.itemRevision,
            version: pending.restoreState.version,
            phase: 'awaitingSync'
          };
        }
        return next;
      });
      handleError(error);
    } finally {
      resourceOrderSavePendingRef.current = false;
      setResourceOrderSaving(false);
    }
  }, [allocation, data, displayItems, handleError, notify, pendingOverrideItems, rankMutationPending, rankMutationReady, rankScopeKey, registeredFseibans, scopeReady, sourceRevision, overridesPending, updateResourceOrderAsync, visibleItems]);

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
      notify('最新状態を取得しました。対象を選び直して再適用してください。', 'success');
    } catch {
      setEditorError('最新状態を取得できませんでした。再試行してください。');
    }
  };

  const changeRank = useCallback(async (item: GrindingPlanningBoardItem, rank: number | null) => {
    if (!data || !rankMutationReady || allocation === 'original' || item.isCompleted || rankMutationPending || resourceOrderSaving || resourceOrderSavePendingRef.current || (pendingOverrideItems[item.itemId] != null && pendingOverrideItems[item.itemId].responseItemRevision == null)) return;
    const requestId = ++rankRequestIdRef.current;
    const requestScopeKey = rankScopeKey;
    setRankConflict(false);
    setPendingRankOverrides((current) => {
      const previous = current[item.itemId];
      const previousState: RankDisplayState = previous?.phase === 'awaitingSync'
        ? { rank: previous.rank, itemRevision: previous.itemRevision, version: previous.version }
        : { rank: item.alternateRank, itemRevision: item.itemRevision, version: item.version };
      return {
        ...current,
        [item.itemId]: {
          scopeKey: requestScopeKey,
          requestId,
          staleStates: previous == null ? [previousState] : [...previous.staleStates, previousState],
          restoreState: previousState,
          itemRevision: item.itemRevision,
          version: item.version,
          rank,
          phase: 'saving'
        }
      };
    });
    notify('個別順位を保存中…', 'processing');
    try {
      const result: GrindingPlanningBoardRankResponse = await updateRankAsync({ sourceRevision, itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, alternateRank: rank });
      setPendingRankOverrides((current) => {
        const pending = current[item.itemId];
        if (!pending || pending.requestId !== requestId || pending.scopeKey !== requestScopeKey) return current;
        return {
          ...current,
          [item.itemId]: {
            ...pending,
            rank: result.alternateRank,
            itemRevision: result.itemRevision,
            version: result.overrideVersion,
            phase: 'awaitingSync'
          }
        };
      });
      notify('個別順位を保存しました。', 'success');
    } catch (error) {
      setPendingRankOverrides((current) => {
        const pending = current[item.itemId];
        if (!pending || pending.requestId !== requestId || pending.scopeKey !== requestScopeKey) return current;
        const restoredStates = [...pending.staleStates, { rank: pending.rank, itemRevision: pending.itemRevision, version: pending.version }];
        return {
          ...current,
          [item.itemId]: {
            ...pending,
            staleStates: restoredStates,
            rank: pending.restoreState.rank,
            itemRevision: pending.restoreState.itemRevision,
            version: pending.restoreState.version,
            phase: 'awaitingSync'
          }
        };
      });
      handleError(error);
    }
  }, [allocation, data, handleError, notify, pendingOverrideItems, rankMutationPending, rankMutationReady, rankScopeKey, resourceOrderSaving, sourceRevision, updateRankAsync]);

  const persistOrder = async (nextOrder: string[]): Promise<boolean> => {
    if (!data || !scopeReady || allocation === 'original') return false;
    if (nextOrder.length > 50) {
      setOrderRegistrationError('登録上限50件を超えるため保存できません。選択を減らしてください。');
      return false;
    }
    if (orderRequestPendingRef.current) return false;
    const previous = registeredFseibans;
    const requestSourceRevision = latestOrderSourceRevisionRef.current ?? sourceRevision;
    setOrderRegistrationError(null);
    orderRequestPendingRef.current = true;
    staleOrderSourceRevisionsRef.current.add(requestSourceRevision);
    pendingOrderRef.current = { order: nextOrder, baseSourceRevision: requestSourceRevision, responseSourceRevision: null };
    setOrderSaving(true);
    setOrderConflict(false);
    setRegisteredFseibans(nextOrder);
    notify('製番順を保存中…', 'processing');
    try {
      const result = await updateOrder.mutateAsync({ sourceRevision: requestSourceRevision, fseibans: nextOrder });
      orderRequestPendingRef.current = false;
      pendingOrderRef.current = { order: result.seibanOrder, baseSourceRevision: requestSourceRevision, responseSourceRevision: result.sourceRevision };
      staleOrderSourceRevisionsRef.current.delete(result.sourceRevision);
      latestOrderSourceRevisionRef.current = result.sourceRevision;
      setOrderSaving(false);
      setRegisteredFseibans(result.seibanOrder);
      notify('製番順を保存しました。', 'success');
      return true;
    } catch (error) {
      orderRequestPendingRef.current = false;
      pendingOrderRef.current = null;
      staleOrderSourceRevisionsRef.current.delete(requestSourceRevision);
      latestOrderSourceRevisionRef.current = requestSourceRevision;
      setOrderSaving(false);
      setRegisteredFseibans(previous);
      if (isAxiosError(error) && error.response?.status === 409) {
        setOrderConflict(true);
        setOrderRegistrationError('製番順が他端末で更新されています。最新状態を取得してから再登録してください。');
        notify('製番順が更新されています。最新状態を取得してください。', 'error');
        return false;
      }
      setOrderRegistrationError('製番登録を保存できませんでした。通信状態と入力値を確認してください。');
      handleError(error);
      return false;
    }
  };

  const refreshAfterOrderConflict = async () => {
    notify('最新状態を取得しています…', 'processing');
    const result = await boardQuery.refetch();
    if (result.isError || !result.data) {
      notify('最新状態を取得できませんでした。再試行してください。', 'error');
      return;
    }
    pendingOrderRef.current = null;
    if (latestOrderSourceRevisionRef.current != null && latestOrderSourceRevisionRef.current !== result.data.sourceRevision) {
      staleOrderSourceRevisionsRef.current.add(latestOrderSourceRevisionRef.current);
    }
    latestOrderSourceRevisionRef.current = result.data.sourceRevision;
    setOrderRegistrationError(null);
    setOrderSaving(false);
    setRegisteredFseibans(result.data.registeredFseibans);
    setOrderConflict(false);
    setRankConflict(false);
    notify('最新状態を取得しました。', 'success');
  };

  const removeSeiban = (fseiban: string) => {
    const next = registeredFseibans.filter((value) => value !== fseiban);
    void persistOrder(next).then((saved) => {
      if (saved) {
        setActiveFseibans((current) => new Set([...current].filter((value) => value !== fseiban)));
        setOpenFseibans((current) => new Set([...current].filter((value) => value !== fseiban)));
        setDueDetailTargetFseiban((current) => current === fseiban ? null : current);
        setDueDetailFseiban((current) => current === fseiban ? null : current);
      }
    });
  };
  const addSeiban = async (fseiban: string): Promise<boolean> => {
    const value = fseiban.trim();
    if (!value || registeredFseibans.includes(value)) return false;
    if (registeredFseibans.length >= 50) {
      setOrderRegistrationError('登録上限50件を超えるため保存できません。先に登録済み製番を解除してください。');
      return false;
    }
    const saved = await persistOrder([value, ...registeredFseibans]);
    if (saved) {
      setActiveFseibans((current) => new Set([value, ...current]));
      setOpenFseibans((current) => new Set([value, ...current]));
    }
    return saved;
  };
  const addSeibans = async (fseibans: readonly string[]): Promise<boolean> => {
    const additions = [...new Set(fseibans.map((value) => value.trim()).filter(Boolean))]
      .filter((value) => !registeredFseibans.includes(value));
    if (additions.length === 0) return true;
    if (registeredFseibans.length + additions.length > 50) {
      setOrderRegistrationError('登録上限50件を超えるため保存できません。選択を減らしてください。');
      return false;
    }
    const saved = await persistOrder([...additions, ...registeredFseibans]);
    if (saved) {
      setActiveFseibans((current) => new Set([...additions, ...current]));
      setOpenFseibans((current) => new Set([...additions, ...current]));
    }
    return saved;
  };
  const moveSeiban = (fseiban: string, direction: 'up' | 'down') => {
    const index = registeredFseibans.indexOf(fseiban);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || target < 0 || target >= registeredFseibans.length) return;
    const next = [...registeredFseibans];
    [next[index], next[target]] = [next[target], next[index]];
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
        bulkDisabled={allocation === 'original' || toolbarSelectedItems.length === 0 || !bulkReady || rankMutationPending || resourceOrderSaving}
        registeredCount={registeredFseibans.length}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCategoryChange={setCategory}
        onViewChange={setView}
        onStatusChange={setStatus}
        onAllocationChange={setAllocation}
        onOpenDueEditor={() => openEditor(toolbarSelectedItems)}
        specialDueMode={view === 'resource' ? specialDueMode : null}
        onSpecialDueModeChange={view === 'resource' ? setSpecialDueMode : undefined}
        specialDueDisabled={allocation === 'original' || interactionLocked || resourceDragDisabled}
      />
      {feedback ? (
        <div className={feedbackKind === 'error'
          ? 'mt-2 flex items-center justify-between gap-2 rounded-md border border-rose-500/50 bg-rose-950/70 px-3 py-2 text-xs text-rose-100'
          : feedbackKind === 'processing'
            ? 'mt-2 flex items-center justify-between gap-2 rounded-md border border-sky-500/40 bg-sky-950/60 px-3 py-2 text-xs text-sky-100'
            : 'mt-2 flex items-center justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-950/60 px-3 py-2 text-xs text-emerald-100'} role="status">
          <span>{feedback}</span>
          <span className="flex shrink-0 items-center gap-1">
            {orderConflict || rankConflict ? <button type="button" className="min-h-9 rounded border border-emerald-300/50 px-2 text-emerald-100" onClick={() => void refreshAfterOrderConflict()}>最新状態を取得</button> : null}
            <button type="button" className="min-h-9 px-2 text-slate-300" onClick={clearFeedback} aria-label="通知を閉じる">✕</button>
          </span>
        </div>
      ) : null}
      {boardQuery.isLoading || !scopeReady ? <p className="px-1 py-2 text-xs text-slate-400" role="status">一覧を読み込み中…</p> : null}
      {boardQuery.isAppending ? <p className="px-1 py-1 text-xs text-slate-400" role="status">一覧を追加取得中…</p> : null}
      {boardQuery.appendError ? <p className="px-1 py-1 text-xs text-rose-200" role="alert">一覧の追加取得に失敗しました。再読み込みしてください。</p> : null}
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
        onMove={allocation === 'original' || orderSaving || interactionLocked ? () => undefined : moveSeiban}
        orderReadOnly={allocation === 'original' || interactionLocked}
        orderBusy={orderSaving || interactionLocked}
        orderStatus={interactionLocked ? (boardQuery.isError ? '一覧を読み込めませんでした。' : '一覧を読み込み中…') : orderSaving ? '製番順を保存中…' : null}
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
          dueUpdatePending={updateDueScope.isPending}
          readOnly={allocation === 'original' || dueConflict || pendingDueScope?.fseiban === dueDetailFseiban}
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
          <fieldset disabled={allocation === 'original' || overridesPending}>
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
          <fieldset disabled={allocation === 'original' || overridesPending}>
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
            <Button type="button" variant="primary" disabled={allocation === 'original' || overridesPending || (resourceChoice === 'unchanged' && dueMode === 'none')} onClick={() => void applyEditor()}>{overridesPending ? '適用中…' : '適用'}</Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
