import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


import {
  useKioskProductionScheduleResources,
  useKioskGrindingPlanningBoardProgressive,
  useKioskGrindingPlanningBoardDueDetail,
  useUpdateKioskGrindingPlanningBoardOverrides,
  useUpdateKioskGrindingPlanningBoardDueScope,
  useUpdateKioskGrindingPlanningBoardRank,
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
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardDueRequest
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

type DuePickerState = {
  fseiban: string;
  value: string;
  scope: GrindingPlanningBoardDueScope;
  snapshot: Pick<GrindingPlanningBoardDueScopeSnapshot, 'sourceGenerationToken' | 'scopeRevision'>;
};

type PendingRankOverride = {
  scopeKey: string;
  requestId: number;
  baseRank: number | null;
  baseItemRevision: string;
  baseVersion: number;
  rank: number | null;
  phase: 'saving' | 'awaitingSync';
};

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
  const [excludedItemIdsByCategory, setExcludedItemIdsByCategory] = useState<Record<string, ReadonlySet<string>>>({});
  const [orderInitialized, setOrderInitialized] = useState(false);
  const [activeInitialized, setActiveInitialized] = useState(false);
  const [openInitialized, setOpenInitialized] = useState(false);
  const pendingOrderRef = useRef<string[] | null>(null);
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
  const [dueDetailFseiban, setDueDetailFseiban] = useState<string | null>(null);
  const [dueDetailTargetFseiban, setDueDetailTargetFseiban] = useState<string | null>(null);
  const [duePickerState, setDuePickerState] = useState<DuePickerState | null>(null);
  const [dueConflict, setDueConflict] = useState(false);
  const [dueError, setDueError] = useState<string | null>(null);
  const [pendingRankOverrides, setPendingRankOverrides] = useState<Record<string, PendingRankOverride>>({});
  const rankRequestIdRef = useRef(0);

  const boardQuery = useKioskGrindingPlanningBoardProgressive(
    { category, view, completionFilter: status },
    { refetchIntervalMs: editorOpen ? false : undefined }
  );
  const resourcesQuery = useKioskProductionScheduleResources({ pauseRefetch: true });
  const dueDetailQuery = useKioskGrindingPlanningBoardDueDetail(dueDetailFseiban);
  const updateOverrides = useUpdateKioskGrindingPlanningBoardOverrides();
  const updateDueScope = useUpdateKioskGrindingPlanningBoardDueScope();
  const { mutateAsync: updateRankAsync } = useUpdateKioskGrindingPlanningBoardRank();
  const updateOrder = useUpdateKioskGrindingPlanningBoardSeibanOrder();

  const data = boardQuery.data;
  const scopeReady = boardQuery.scopeReady;
  const bulkReady = scopeReady && boardQuery.isComplete;
  const interactionLocked = !scopeReady;
  const sourceRevision = data?.sourceRevision ?? '';
  const rankScopeKey = `${data?.siteKey ?? ''}\0${category}\0${status}`;
  const rankSyncPending = Object.values(pendingRankOverrides).some(
    (pending) => pending.scopeKey === rankScopeKey
  );

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
        if (
          pending.phase === 'awaitingSync' &&
          (currentItem == null ||
            currentItem.itemRevision !== pending.baseItemRevision ||
            currentItem.version !== pending.baseVersion)
        ) {
          changed = true;
          continue;
        }
        next[itemId] = pending;
      }
      return changed ? next : current;
    });
  }, [data, pendingRankOverrides, rankScopeKey]);

  useEffect(() => {
    if (!boardQuery.isError) return;
    setPendingRankOverrides((current) => (Object.keys(current).length > 0 ? {} : current));
  }, [boardQuery.isError]);

  const displayItems = useMemo(() => {
    if (!data) return [];
    return data.items.map((item) => {
      const pending = pendingRankOverrides[item.itemId];
      if (!pending || pending.scopeKey !== rankScopeKey) return item;
      return { ...item, alternateRank: pending.rank };
    });
  }, [data, pendingRankOverrides, rankScopeKey]);
  const dueDetail = allocation === 'original'
    ? dueDetailQuery.data?.original
    : dueDetailQuery.data?.alternate;

  useEffect(() => {
    if (!data) return;
    const serverOrder = data.registeredFseibans;
    const pending = pendingOrderRef.current;
    if (!orderInitialized) {
      setRegisteredFseibans(serverOrder);
      setOrderInitialized(true);
    } else if (!orderSaving && pending && pending.every((value, index) => serverOrder[index] === value) && pending.length === serverOrder.length) {
      pendingOrderRef.current = null;
    } else if (!pending) {
      setRegisteredFseibans(serverOrder);
    }
    if (!activeInitialized) {
      setActiveFseibans(new Set(data.seibanOrder));
      setActiveInitialized(true);
    }
    setDueDetailTargetFseiban((current) => current && serverOrder.includes(current) ? current : serverOrder[0] ?? null);
    if (!openInitialized) {
      setOpenFseibans(new Set(data.seibanOrder));
      setOpenInitialized(true);
    }
  }, [activeInitialized, data, openInitialized, orderInitialized, orderSaving]);

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
      const excludedItemIds = excludedItemIdsByCategory[category] ?? new Set<string>();
      return new Set(visibleItems.filter((item) => !item.isCompleted && !excludedItemIds.has(item.itemId)).map((item) => item.itemId));
    },
    [category, excludedItemIdsByCategory, visibleItems]
  );
  const selectedVisibleItems = useMemo(
    () => visibleItems.filter((item) => !item.isCompleted && selectedItemIds.has(item.itemId)),
    [selectedItemIds, visibleItems]
  );
  const editorItems = editorSnapshot?.items ?? [];

  const handleError = useCallback((error: unknown) => {
    if (isAxiosError(error) && error.response?.status === 409) {
      setRankConflict(true);
      setFeedback('表示中のデータが更新されています。最新状態を取得してください。');
      return;
    }
    setFeedback('保存できませんでした。時間をおいて再試行してください。');
  }, []);

  const toggleItem = useCallback((item: GrindingPlanningBoardItem, selected: boolean) => {
    if (!scopeReady || item.isCompleted) return;
    setExcludedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      if (selected) next.delete(item.itemId); else next.add(item.itemId);
      return { ...current, [category]: next };
    });
  }, [category, scopeReady]);

  const toggleAll = useCallback((items: readonly GrindingPlanningBoardItem[], selected: boolean) => {
    if (!bulkReady) return;
    setExcludedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      for (const item of items) {
        if (item.isCompleted) continue;
        if (selected) next.delete(item.itemId); else next.add(item.itemId);
      }
      return { ...current, [category]: next };
    });
  }, [bulkReady, category]);

  const openEditor = useCallback((items: readonly GrindingPlanningBoardItem[]) => {
    if (!scopeReady) return;
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
    setFeedback(null);
    setEditorError(null);
    setEditorConflict(false);
    setEditorOpen(true);
  }, [allocation, data, scopeReady]);

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
    if (!dueDetailFseiban || !detail || allocation === 'original' || dueConflict) return;
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
  }, [allocation, dueConflict, dueDetailFseiban, dueDetailQuery.data]);

  const refreshDueDetail = useCallback(async () => {
    setDueError('最新状態を取得しています…');
    try {
      const [detailResult, boardResult] = await Promise.all([dueDetailQuery.refetch(), boardQuery.refetch()]);
      if (detailResult.isError || boardResult.isError) {
        setDueError('最新状態を取得できませんでした。再試行してください。');
        return;
      }
      setDueConflict(false);
      setDueError(null);
      setFeedback('最新状態を取得しました。対象を選び直して再適用してください。');
    } catch {
      setDueError('最新状態を取得できませんでした。再試行してください。');
    }
  }, [boardQuery, dueDetailQuery]);

  const commitDueDate = useCallback(async (nextDueDate: string) => {
    const current = duePickerState;
    if (!current || allocation === 'original' || dueRequestPendingRef.current) return;
    dueRequestPendingRef.current = true;
    try {
      await updateDueScope.mutateAsync({
        fseiban: current.fseiban,
        payload: {
          ...current.snapshot,
          scope: current.scope,
          dueDate: nextDueDate
        }
      });
      if (dueDetailIdentityRef.current !== current.fseiban) return;
      setDuePickerState(null);
      setDueConflict(false);
      setDueError(null);
      setFeedback(`${current.fseiban}の納期を更新しました。`);
    } catch (error) {
      if (dueDetailIdentityRef.current !== current.fseiban) return;
      setDuePickerState(null);
      if (isAxiosError(error) && error.response?.status === 409) {
        setDueConflict(true);
        setDueError('表示中の納期が更新されています。最新状態を取得してから再適用してください。');
      } else {
        setDueError('納期を保存できませんでした。入力内容と通信状態を確認してください。');
      }
    } finally {
      dueRequestPendingRef.current = false;
    }
  }, [allocation, duePickerState, updateDueScope]);

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
    try {
      await updateOverrides.mutateAsync({ sourceRevision: editorSnapshot.sourceRevision, items });
      setEditorOpen(false);
      setFeedback(`${items.length}件を更新しました。`);
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        setEditorConflict(true);
        setEditorError('表示中のデータが更新されています。最新状態を取得してから対象を選び直してください。');
      } else if (isAxiosError(error) && typeof error.response?.data?.message === 'string') {
        setEditorError(`保存できませんでした: ${error.response.data.message}`);
      } else {
        setEditorError('保存できませんでした。入力内容とネットワーク接続を確認してください。');
      }
    }
  };

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
      setFeedback('最新状態を取得しました。対象を選び直して再適用してください。');
    } catch {
      setEditorError('最新状態を取得できませんでした。再試行してください。');
    }
  };

  const changeRank = useCallback(async (item: GrindingPlanningBoardItem, rank: number | null) => {
    if (!data || !scopeReady || allocation === 'original' || item.isCompleted || rankSyncPending) return;
    const requestId = ++rankRequestIdRef.current;
    const requestScopeKey = rankScopeKey;
    setRankConflict(false);
    setPendingRankOverrides((current) => ({
      ...current,
      [item.itemId]: {
        scopeKey: requestScopeKey,
        requestId,
        baseRank: item.alternateRank,
        baseItemRevision: item.itemRevision,
        baseVersion: item.version,
        rank,
        phase: 'saving'
      }
    }));
    try {
      await updateRankAsync({ sourceRevision, itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, alternateRank: rank });
      setPendingRankOverrides((current) => {
        const pending = current[item.itemId];
        if (!pending || pending.requestId !== requestId || pending.scopeKey !== requestScopeKey) return current;
        if (pending.baseRank === rank) {
          const next = { ...current };
          delete next[item.itemId];
          return next;
        }
        return {
          ...current,
          [item.itemId]: {
            ...pending,
            phase: 'awaitingSync'
          }
        };
      });
    } catch (error) {
      setPendingRankOverrides((current) => {
        const pending = current[item.itemId];
        if (!pending || pending.requestId !== requestId || pending.scopeKey !== requestScopeKey) return current;
        const next = { ...current };
        delete next[item.itemId];
        return next;
      });
      handleError(error);
    }
  }, [allocation, data, handleError, rankScopeKey, rankSyncPending, scopeReady, sourceRevision, updateRankAsync]);

  const persistOrder = async (nextOrder: string[]): Promise<boolean> => {
    if (!data || !scopeReady || nextOrder.length > 50 || allocation === 'original') return false;
    if (orderRequestPendingRef.current) return false;
    const previous = registeredFseibans;
    setOrderRegistrationError(null);
    orderRequestPendingRef.current = true;
    pendingOrderRef.current = nextOrder;
    setOrderSaving(true);
    setOrderConflict(false);
    setRegisteredFseibans(nextOrder);
    try {
      const result = await updateOrder.mutateAsync({ sourceRevision, fseibans: nextOrder });
      orderRequestPendingRef.current = false;
      pendingOrderRef.current = null;
      setOrderSaving(false);
      setRegisteredFseibans(result.seibanOrder);
      return true;
    } catch (error) {
      orderRequestPendingRef.current = false;
      pendingOrderRef.current = null;
      setOrderSaving(false);
      setRegisteredFseibans(previous);
      if (isAxiosError(error) && error.response?.status === 409) {
        setOrderConflict(true);
        setOrderRegistrationError('製番順が他端末で更新されています。最新状態を取得してから再登録してください。');
        setFeedback('製番順が更新されています。最新状態を取得してください。');
        return false;
      }
      setOrderRegistrationError('製番登録を保存できませんでした。通信状態と入力値を確認してください。');
      handleError(error);
      return false;
    }
  };

  const refreshAfterOrderConflict = async () => {
    setFeedback('最新状態を取得しています…');
    const result = await boardQuery.refetch();
    if (result.isError || !result.data) {
      setFeedback('最新状態を取得できませんでした。再試行してください。');
      return;
    }
    pendingOrderRef.current = null;
    setOrderRegistrationError(null);
    setOrderSaving(false);
    setRegisteredFseibans(result.data.registeredFseibans);
    setOrderConflict(false);
    setRankConflict(false);
    setFeedback('最新状態を取得しました。');
  };

  const removeSeiban = (fseiban: string) => {
    const next = registeredFseibans.filter((value) => value !== fseiban);
    void persistOrder(next).then((saved) => {
      if (saved) {
        setActiveFseibans((current) => new Set([...current].filter((value) => value !== fseiban)));
        setDueDetailTargetFseiban((current) => current === fseiban ? null : current);
        setDueDetailFseiban((current) => current === fseiban ? null : current);
      }
    });
  };
  const addSeiban = async (fseiban: string): Promise<boolean> => {
    const value = fseiban.trim();
    if (!value || registeredFseibans.includes(value) || registeredFseibans.length >= 50) return false;
    const saved = await persistOrder([value, ...registeredFseibans]);
    if (saved) setActiveFseibans((current) => new Set([value, ...current]));
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
        bulkDisabled={allocation === 'original' || toolbarSelectedItems.length === 0 || !bulkReady || rankSyncPending}
        registeredCount={registeredFseibans.length}
        onOpenDrawer={() => setDrawerOpen(true)}
        onCategoryChange={setCategory}
        onViewChange={setView}
        onStatusChange={setStatus}
        onAllocationChange={setAllocation}
        onOpenDueEditor={() => openEditor(toolbarSelectedItems)}
      />
      {feedback ? (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-emerald-500/40 bg-emerald-950/60 px-3 py-2 text-xs text-emerald-100" role="status">
          <span>{feedback}</span>
          <span className="flex shrink-0 items-center gap-1">
            {orderConflict || rankConflict ? <button type="button" className="min-h-9 rounded border border-emerald-300/50 px-2 text-emerald-100" onClick={() => void refreshAfterOrderConflict()}>最新状態を取得</button> : null}
            <button type="button" className="min-h-9 px-2 text-slate-300" onClick={() => setFeedback(null)} aria-label="通知を閉じる">✕</button>
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
            disabled={interactionLocked || rankSyncPending}
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
                disabled={interactionLocked || rankSyncPending}
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
            onRankChange={changeRank}
            disabled={interactionLocked || rankSyncPending}
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
          readOnly={allocation === 'original' || dueConflict}
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
          <fieldset disabled={allocation === 'original' || updateOverrides.isPending}>
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
          <fieldset disabled={allocation === 'original' || updateOverrides.isPending}>
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
            <Button type="button" variant="primary" disabled={allocation === 'original' || updateOverrides.isPending || (resourceChoice === 'unchanged' && dueMode === 'none')} onClick={() => void applyEditor()}>{updateOverrides.isPending ? '適用中…' : '適用'}</Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
