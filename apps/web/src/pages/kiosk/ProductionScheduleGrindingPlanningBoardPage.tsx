import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';


import {
  useKioskGrindingPlanningBoardSnapshot,
  useUpdateKioskGrindingPlanningBoardOverrides,
  useUpdateKioskGrindingPlanningBoardRank,
  useUpdateKioskGrindingPlanningBoardSeibanOrder
} from '../../api/hooks';
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

import type { PlanningBoardAllocation, PlanningBoardStatus } from '../../features/kiosk/grindingPlanningBoard/types';
import type {
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

function getGroupProgress(data: GrindingPlanningBoardResponse | undefined, fseiban: string) {
  return data?.seibanProgress[fseiban] ?? null;
}

type DueMode = 'none' | 'date' | 'offsetDays' | 'restore';
type ResourceChoice = 'unchanged' | 'restore' | string;

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

  const boardQuery = useKioskGrindingPlanningBoardSnapshot(
    { category, view, completionFilter: status },
    { refetchIntervalMs: editorOpen ? false : 30000, refetchOnWindowFocus: !editorOpen }
  );
  const updateOverrides = useUpdateKioskGrindingPlanningBoardOverrides();
  const updateRank = useUpdateKioskGrindingPlanningBoardRank();
  const updateOrder = useUpdateKioskGrindingPlanningBoardSeibanOrder();

  const data = boardQuery.data;
  const sourceRevision = data?.sourceRevision ?? '';

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
    if (!openInitialized) {
      setOpenFseibans(new Set(data.seibanOrder));
      setOpenInitialized(true);
    }
  }, [activeInitialized, data, openInitialized, orderInitialized, orderSaving]);

  useEffect(() => {
    setFocusedFseiban(null);
  }, [view]);

  const itemsBySeiban = useMemo(() => {
    const grouped = new Map<string, GrindingPlanningBoardItem[]>();
    for (const item of data?.items ?? []) {
      const group = grouped.get(item.fseiban) ?? [];
      group.push(item);
      grouped.set(item.fseiban, group);
    }
    return grouped;
  }, [data?.items]);
  const machineNames = useMemo(() => {
    const result = new Map<string, string | null>();
    for (const item of data?.items ?? []) if (!result.has(item.fseiban)) result.set(item.fseiban, item.machineName);
    return result;
  }, [data?.items]);
  const visibleItems = useMemo(
    () => (data?.items ?? []).filter((item) => activeFseibans.has(item.fseiban)),
    [activeFseibans, data?.items]
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
    if (item.isCompleted) return;
    setExcludedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      if (selected) next.delete(item.itemId); else next.add(item.itemId);
      return { ...current, [category]: next };
    });
  }, [category]);

  const toggleAll = useCallback((items: readonly GrindingPlanningBoardItem[], selected: boolean) => {
    setExcludedItemIdsByCategory((current) => {
      const next = new Set(current[category] ?? []);
      for (const item of items) {
        if (item.isCompleted) continue;
        if (selected) next.delete(item.itemId); else next.add(item.itemId);
      }
      return { ...current, [category]: next };
    });
  }, [category]);

  const openEditor = useCallback((items: readonly GrindingPlanningBoardItem[]) => {
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
  }, [allocation, data]);

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

  const changeRank = async (item: GrindingPlanningBoardItem, rank: number | null) => {
    if (!data || allocation === 'original' || item.isCompleted) return;
    try {
      await updateRank.mutateAsync({ sourceRevision, itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, alternateRank: rank });
    } catch (error) {
      handleError(error);
    }
  };

  const persistOrder = async (nextOrder: string[]): Promise<boolean> => {
    if (!data || nextOrder.length > 50 || allocation === 'original') return false;
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
      if (saved) setActiveFseibans((current) => new Set([...current].filter((value) => value !== fseiban)));
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

  const focusItems = focusedFseiban ? itemsBySeiban.get(focusedFseiban) ?? [] : [];
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
        bulkDisabled={allocation === 'original' || toolbarSelectedItems.length === 0}
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
      {boardQuery.isLoading ? <p className="p-5 text-sm text-slate-300">読み込み中…</p> : null}
      {boardQuery.isError ? <p className="p-5 text-sm text-rose-200">一覧を読み込めませんでした。</p> : null}
      {data && view === 'seiban' && focusedFseiban && focusItems.length > 0 ? (
        <div className="mt-2">
          <PlanningBoardFocusView
            fseiban={focusedFseiban}
            machineName={machineNames.get(focusedFseiban) ?? null}
            items={sortGrindingPlanningBoardItems(focusItems, registeredFseibans, view, allocation)}
            progress={getGroupProgress(data, focusedFseiban)}
            allocation={allocation}
            selectedItemIds={selectedItemIds}
            onBack={() => setFocusedFseiban(null)}
            onToggleAll={(selected) => toggleAll(focusItems, selected)}
            onToggleItem={toggleItem}
            onResourceClick={(item) => openEditor([item])}
            onRankChange={changeRank}
          />
        </div>
      ) : data && view === 'seiban' ? (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {registeredFseibans.filter((fseiban) => activeFseibans.has(fseiban)).map((fseiban) => {
            const group = itemsBySeiban.get(fseiban) ?? [];
            if (group.length === 0) return null;
            return (
              <PlanningBoardSeibanPane
                key={fseiban}
                fseiban={fseiban}
                machineName={machineNames.get(fseiban) ?? null}
                items={sortGrindingPlanningBoardItems(group, registeredFseibans, view, allocation)}
                progress={getGroupProgress(data, fseiban)}
                allocation={allocation}
                selectedItemIds={selectedItemIds}
                isOpen={openFseibans.has(fseiban)}
                isFocused={false}
                onToggleOpen={() => setOpenFseibans((current) => {
                  const next = new Set(current); if (next.has(fseiban)) next.delete(fseiban); else next.add(fseiban); return next;
                })}
                onFocus={() => setFocusedFseiban(fseiban)}
                onToggleAll={(selected) => toggleAll(group, selected)}
                onToggleItem={toggleItem}
                onResourceClick={(item) => openEditor([item])}
                onRankChange={changeRank}
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
            load={data.load}
            allocation={allocation}
            selectedItemIds={selectedItemIds}
            onToggleItem={toggleItem}
            onResourceClick={(item) => openEditor([item])}
            onRankChange={changeRank}
          />
        </div>
      ) : null}
      <PlanningBoardSeibanDrawer
        isOpen={drawerOpen}
        registeredFseibans={registeredFseibans}
        selectedFseibans={activeFseibans}
        machineNameBySeiban={machineNames}
        onClose={() => {
          setDrawerOpen(false);
          setOrderRegistrationError(null);
        }}
        registrationError={orderRegistrationError}
        onRefreshOrder={orderConflict ? () => void refreshAfterOrderConflict() : undefined}
        onRegister={allocation === 'original' ? async () => false : addSeiban}
        onRemove={allocation === 'original' ? () => undefined : removeSeiban}
        onToggle={(fseiban) => setActiveFseibans((current) => {
          const next = new Set(current);
          if (next.has(fseiban)) next.delete(fseiban); else next.add(fseiban);
          return next;
        })}
        onClear={() => setActiveFseibans(new Set())}
        onMove={allocation === 'original' || orderSaving ? () => undefined : moveSeiban}
        orderReadOnly={allocation === 'original'}
        orderBusy={orderSaving}
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
