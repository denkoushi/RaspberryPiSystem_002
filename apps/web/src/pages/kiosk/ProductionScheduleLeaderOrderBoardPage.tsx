import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  getKioskProductionSchedule,
  updateKioskProductionScheduleOrder,
  type ProductionScheduleRow
} from '../../api/client';
import { useKioskProductionSchedule, useKioskProductionScheduleResources } from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { applyResourceOrderReorder } from '../../features/kiosk/leaderOrderBoard/applyResourceOrderReorder';
import { leaderOrderBoardQueryPageSize } from '../../features/kiosk/leaderOrderBoard/constants';
import { groupRowsByResourceCd } from '../../features/kiosk/leaderOrderBoard/groupRowsByResourceCd';
import { LeaderBoardApplyError } from '../../features/kiosk/leaderOrderBoard/leaderBoardApplyErrors';
import { LeaderBoardResourceSlotPickerModal } from '../../features/kiosk/leaderOrderBoard/LeaderBoardResourceSlotPickerModal';
import { LeaderOrderResourceCard } from '../../features/kiosk/leaderOrderBoard/LeaderOrderResourceCard';
import { normalizeLeaderBoardRows } from '../../features/kiosk/leaderOrderBoard/normalizeLeaderBoardRow';
import { sortRowsByDisplayDue } from '../../features/kiosk/leaderOrderBoard/sortRowsByDisplayDue';
import { useLeaderBoardResourceSlots } from '../../features/kiosk/leaderOrderBoard/useLeaderBoardResourceSlots';
import { assertCompletePage } from '../../features/kiosk/leaderOrderBoard/validateApplyPreconditions';
import { useManualOrderCardState } from '../../features/kiosk/productionSchedule/useManualOrderCardState';
import { useManualOrderPageController } from '../../features/kiosk/productionSchedule/useManualOrderPageController';
import { useMutationFeedback } from '../../features/kiosk/productionSchedule/useMutationFeedback';
import { useProductionScheduleMutations } from '../../features/kiosk/productionSchedule/useProductionScheduleMutations';
import { useProductionScheduleQueryParams } from '../../features/kiosk/productionSchedule/useProductionScheduleQueryParams';
import { useProductionScheduleSearchConditionsWithStorageKey } from '../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions';
import { useKioskLeftEdgeDrawerReveal } from '../../hooks/useKioskLeftEdgeDrawerReveal';
import { isMacEnvironment } from '../../lib/client-key/resolver';

const LEADER_ORDER_BOARD_SEARCH_STORAGE_KEY = 'leader-order-board-search-conditions';

const MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED =
  import.meta.env.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED !== 'false';

export function ProductionScheduleLeaderOrderBoardPage() {
  const queryClient = useQueryClient();
  const isMac = typeof window !== 'undefined' ? isMacEnvironment(window.navigator.userAgent) : false;
  const macManualOrderV2 = isMac && MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED;

  const { siteKey, defaultSites, deviceCards, handleSiteChange } = useManualOrderPageController();
  const {
    activeDeviceScopeKey,
    setActiveDeviceScopeKey,
    statusMap,
    setDeviceStatus,
    clearDeviceStatus
  } = useManualOrderCardState(deviceCards.map((d) => d.deviceScopeKey));

  const [searchConditions, setSearchConditions] = useProductionScheduleSearchConditionsWithStorageKey(
    LEADER_ORDER_BOARD_SEARCH_STORAGE_KEY
  );

  useEffect(() => {
    if (!searchConditions.showGrindingResources && !searchConditions.showCuttingResources) {
      setSearchConditions({ showGrindingResources: true, showCuttingResources: true });
    }
  }, [searchConditions.showGrindingResources, searchConditions.showCuttingResources, setSearchConditions]);

  useEffect(() => {
    if (activeDeviceScopeKey.trim().length > 0) return;
    const first = deviceCards[0]?.deviceScopeKey;
    if (first) setActiveDeviceScopeKey(first);
  }, [activeDeviceScopeKey, deviceCards, setActiveDeviceScopeKey]);

  const assignedResourceCds = useMemo(() => {
    const device = deviceCards.find((d) => d.deviceScopeKey === activeDeviceScopeKey);
    if (!device) return [];
    const cds: string[] = [];
    for (const r of device.resources) {
      const cd = r.resourceCd?.trim();
      if (cd) cds.push(cd);
    }
    return cds;
  }, [deviceCards, activeDeviceScopeKey]);

  const slotsScopeKey = useMemo(() => `${siteKey.trim()}\0${activeDeviceScopeKey.trim()}`, [
    siteKey,
    activeDeviceScopeKey
  ]);

  const {
    slotCount,
    setSlotCount,
    resourceCdBySlotIndex,
    assignSlotCd,
    activeResourceCds
  } = useLeaderBoardResourceSlots({
    scopeKey: slotsScopeKey,
    fallbackAssignedResourceCds: assignedResourceCds
  });

  const boardPageSize = useMemo(
    () => leaderOrderBoardQueryPageSize(activeResourceCds.length),
    [activeResourceCds.length]
  );
  const boardPageSizeRef = useRef(boardPageSize);
  boardPageSizeRef.current = boardPageSize;

  const { selectedResourceCategory, queryParams: baseQueryParams, hasResourceCategoryResourceSelection } =
    useProductionScheduleQueryParams({
      activeQueries: searchConditions.activeQueries,
      activeResourceCds: activeResourceCds,
      activeResourceAssignedOnlyCds: searchConditions.activeResourceAssignedOnlyCds,
      hasNoteOnlyFilter: searchConditions.hasNoteOnlyFilter,
      hasDueDateOnlyFilter: searchConditions.hasDueDateOnlyFilter,
      showGrindingResources: searchConditions.showGrindingResources,
      showCuttingResources: searchConditions.showCuttingResources,
      selectedMachineName: searchConditions.selectedMachineName,
      selectedOrderNumbers: [],
      history: []
    });

  const scheduleListParams = useMemo(
    () => ({
      ...baseQueryParams,
      pageSize: boardPageSize,
      allowResourceOnly: true,
      ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
        ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
        : {})
    }),
    [activeDeviceScopeKey, baseQueryParams, boardPageSize, macManualOrderV2]
  );

  const targetDeviceScopeKey =
    macManualOrderV2 && activeDeviceScopeKey.trim().length > 0 ? activeDeviceScopeKey.trim() : undefined;
  const targetDeviceScopeKeyRef = useRef(targetDeviceScopeKey);
  targetDeviceScopeKeyRef.current = targetDeviceScopeKey;

  const searchStateMutation = { isPending: false };
  const {
    pauseRefetch: mutationPauseRefetch,
    orderPending,
    dueDatePending,
    commitDueDate: commitDueDateMutation
  } = useProductionScheduleMutations({
    isSearchStateWriting: searchStateMutation.isPending,
    noteMaxLength: 100,
    productionScheduleTargetDeviceScopeKey: targetDeviceScopeKey
  });

  const { editingDueDateValue, isDueDatePickerOpen, openDueDatePicker, commitDueDate, closeDueDatePicker } =
    useMutationFeedback({
      onCommitNote: () => {
        /* 順位ボードでは未使用 */
      },
      onCommitDueDate: ({ rowId, dueDate, onSettled }) => {
        commitDueDateMutation({
          rowId,
          dueDate,
          onSettled: () => {
            void Promise.all([
              queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] }),
              queryClient.invalidateQueries({
                queryKey: ['kiosk-production-schedule-due-management-manual-order-overview']
              })
            ]);
            onSettled();
          }
        });
      }
    });

  const scheduleEnabled =
    activeDeviceScopeKey.trim().length > 0 &&
    hasResourceCategoryResourceSelection &&
    activeResourceCds.length > 0;

  const applyMutation = useMutation({
    mutationFn: async (resourceCd: string) => {
      const data = await getKioskProductionSchedule({
        resourceCds: resourceCd,
        allowResourceOnly: true,
        page: 1,
        pageSize: boardPageSizeRef.current,
        ...(targetDeviceScopeKeyRef.current
          ? { targetDeviceScopeKey: targetDeviceScopeKeyRef.current }
          : {})
      });
      assertCompletePage(data.total, data.rows.length);
      const normalized = normalizeLeaderBoardRows(data.rows as ProductionScheduleRow[]);
      const forR = normalized.filter((r) => r.resourceCd === resourceCd);
      const sorted = sortRowsByDisplayDue(forR);
      const scope = targetDeviceScopeKeyRef.current;
      await applyResourceOrderReorder(sorted, resourceCd, async ({ rowId, resourceCd: rc, orderNumber }) => {
        await updateKioskProductionScheduleOrder(rowId, {
          resourceCd: rc,
          orderNumber,
          ...(scope ? { targetDeviceScopeKey: scope } : {})
        });
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] }),
        queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-order-usage'] }),
        queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-due-management-manual-order-overview'] })
      ]);
    }
  });

  const resourcesQuery = useKioskProductionScheduleResources({
    pauseRefetch: mutationPauseRefetch || applyMutation.isPending || dueDatePending
  });

  const scheduleQuery = useKioskProductionSchedule(scheduleListParams, {
    enabled: scheduleEnabled,
    pauseRefetch: mutationPauseRefetch || applyMutation.isPending || dueDatePending
  });

  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data]
  );

  const drawerReveal = useKioskLeftEdgeDrawerReveal(true);

  const grouped = useMemo(() => {
    const rows = (scheduleQuery.data?.rows ?? []) as ProductionScheduleRow[];
    const normalized = normalizeLeaderBoardRows(rows);
    return groupRowsByResourceCd(normalized);
  }, [scheduleQuery.data?.rows]);

  const sortedGrouped = useMemo(() => {
    const m = new Map<string, ReturnType<typeof sortRowsByDisplayDue>>();
    grouped.forEach((list, cd) => {
      m.set(cd, sortRowsByDisplayDue(list));
    });
    return m;
  }, [grouped]);

  const listIncomplete =
    scheduleQuery.data != null && scheduleQuery.data.total > scheduleQuery.data.rows.length;

  const [selectedResourceCd, setSelectedResourceCd] = useState<string | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [slotModalOpen, setSlotModalOpen] = useState(false);

  const handleApplySelected = useCallback(async () => {
    if (!selectedResourceCd || listIncomplete || applyMutation.isPending || dueDatePending) return;
    setDrawerError(null);
    clearDeviceStatus(activeDeviceScopeKey);
    setDeviceStatus(activeDeviceScopeKey, 'saving');
    try {
      await applyMutation.mutateAsync(selectedResourceCd);
    } catch (e) {
      const msg =
        e instanceof LeaderBoardApplyError
          ? e.message
          : e instanceof Error
            ? e.message
            : '反映に失敗しました。';
      setDrawerError(msg);
      setDeviceStatus(activeDeviceScopeKey, 'error');
      return;
    }
    setDeviceStatus(activeDeviceScopeKey, 'idle');
  }, [
    activeDeviceScopeKey,
    applyMutation,
    clearDeviceStatus,
    listIncomplete,
    selectedResourceCd,
    setDeviceStatus,
    dueDatePending
  ]);

  const toggleGrinding = () =>
    setSearchConditions((prev) => ({ ...prev, showGrindingResources: !prev.showGrindingResources }));
  const toggleCutting = () =>
    setSearchConditions((prev) => ({ ...prev, showCuttingResources: !prev.showCuttingResources }));

  const gridReady =
    scheduleEnabled && !scheduleQuery.isLoading && !scheduleQuery.isError;

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col bg-[#0c1222] text-white">
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-100"
        style={{
          background:
            'radial-gradient(ellipse 120% 80% at 20% 0%, rgba(34, 211, 238, 0.07), transparent 50%), radial-gradient(ellipse 100% 60% at 100% 100%, rgba(99, 102, 241, 0.06), transparent 45%)'
        }}
      />

      <div className="pointer-events-none fixed inset-y-0 left-0 z-50 flex">
        <div
          className="pointer-events-auto w-[14px] shrink-0"
          onMouseEnter={drawerReveal.onHotZoneEnter}
          aria-hidden
        />
        <aside
          className={clsx(
            'pointer-events-auto flex h-full w-64 max-w-[85vw] flex-col gap-2 border-r border-white/10 bg-slate-900/95 p-3 shadow-xl backdrop-blur-md transition-transform duration-200 ease-out',
            drawerReveal.isVisible ? 'translate-x-0' : '-translate-x-full'
          )}
          onMouseEnter={drawerReveal.onDrawerMouseEnter}
          onMouseLeave={drawerReveal.onDrawerMouseLeave}
          aria-label="操作パネル"
        >
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/55">
            工場
            <select
              value={siteKey}
              onChange={(event) => handleSiteChange(event.target.value)}
              className="rounded border border-white/20 bg-slate-900 px-2 py-2 text-xs text-white"
              aria-label="工場を選択"
            >
              {defaultSites.map((site) => (
                <option key={site} value={site}>
                  {site}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-white/55">
            対象端末
            <select
              value={activeDeviceScopeKey}
              onChange={(ev) => {
                setActiveDeviceScopeKey(ev.target.value);
                setSelectedResourceCd(null);
              }}
              className="rounded border border-white/20 bg-slate-900 px-2 py-2 text-xs text-white"
            >
              {deviceCards.length === 0 ? (
                <option value="">端末なし</option>
              ) : (
                deviceCards.map((d) => (
                  <option key={d.deviceScopeKey} value={d.deviceScopeKey}>
                    {d.label?.trim() || d.deviceScopeKey}
                  </option>
                ))
              )}
            </select>
          </label>
          <div className="flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={toggleGrinding}
              className={clsx(
                'rounded border px-2 py-1',
                searchConditions.showGrindingResources
                  ? 'border-cyan-400/50 bg-cyan-500/20 text-cyan-100'
                  : 'border-white/20 text-white/70'
              )}
            >
              研削
            </button>
            <button
              type="button"
              onClick={toggleCutting}
              className={clsx(
                'rounded border px-2 py-1',
                searchConditions.showCuttingResources
                  ? 'border-amber-400/50 bg-amber-500/20 text-amber-100'
                  : 'border-white/20 text-white/70'
              )}
            >
              切削
            </button>
          </div>
          {selectedResourceCategory ? (
            <p className="text-[10px] text-white/45">検索: {selectedResourceCategory}</p>
          ) : null}
          <button
            type="button"
            onClick={() => setSlotModalOpen(true)}
            className="rounded border border-white/25 bg-slate-800/80 px-2 py-1.5 text-left text-[11px] text-cyan-100 hover:bg-slate-800"
          >
            資源スロット（{activeResourceCds.length}/{slotCount}）
          </button>
          <p className="text-[10px] text-white/55">選択資源: {selectedResourceCd ?? '—'}</p>
          {listIncomplete ? (
            <p className="text-xs text-rose-200">
              一覧が1ページに収まっていません。反映はできません。
            </p>
          ) : null}
          {drawerError ? <p className="text-xs text-rose-200">{drawerError}</p> : null}
          {statusMap[activeDeviceScopeKey] === 'error' ? (
            <p className="text-xs text-rose-200">反映に失敗しました。</p>
          ) : null}
          <button
            type="button"
            disabled={
              !selectedResourceCd ||
              listIncomplete ||
              applyMutation.isPending ||
              orderPending ||
              dueDatePending ||
              !scheduleEnabled
            }
            onClick={() => void handleApplySelected()}
            className="mt-auto rounded border border-cyan-400/50 bg-gradient-to-b from-cyan-500/25 to-cyan-500/10 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {applyMutation.isPending || orderPending || dueDatePending ? '反映中…' : '納期順で反映'}
          </button>
        </aside>
      </div>

      <main
        className={clsx(
          'relative z-10 flex min-h-0 flex-1 flex-col pl-[14px] pr-2 pb-2 pt-2',
          gridReady ? 'overflow-hidden' : 'overflow-auto'
        )}
      >
        {!scheduleEnabled ? (
          <p className="text-sm text-white/60">
            端末を選び、操作パネルで資源スロットに1件以上割り当て、研削/切削の条件を満たすと一覧が表示されます。
          </p>
        ) : scheduleQuery.isLoading ? (
          <p className="text-sm text-white/60">読み込み中…</p>
        ) : scheduleQuery.isError ? (
          <p className="text-sm text-rose-200">一覧の取得に失敗しました。</p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 overflow-auto [grid-auto-rows:minmax(14rem,1fr)] md:grid-cols-4 xl:grid-cols-6">
            {resourceCdBySlotIndex.map((cdRaw, slotIndex) => {
              const cd = cdRaw?.trim() ?? '';
              if (cd.length === 0) {
                return (
                  <div
                    key={`slot-empty-${slotIndex}`}
                    className="flex h-full min-h-[14rem] flex-col rounded-lg border border-dashed border-white/20 bg-slate-900/35 p-2.5"
                  >
                    <div className="text-[11px] font-medium text-white/50">スロット {slotIndex + 1}</div>
                    <p className="mt-2 text-xs text-white/40">未設定（操作パネル→資源スロット）</p>
                  </div>
                );
              }
              const rows = sortedGrouped.get(cd) ?? [];
              const selected = selectedResourceCd === cd;
              const dimmed = selectedResourceCd != null && !selected;
              const jpNames = (resourceNameMap[cd] ?? []).join(' / ');
              return (
                <LeaderOrderResourceCard
                  key={`slot-${slotIndex}-${cd}`}
                  resourceCd={cd}
                  resourceJapaneseNames={jpNames}
                  rows={rows}
                  selected={selected}
                  dimmed={dimmed}
                  onSelect={() => {
                    setSelectedResourceCd(cd);
                    setDrawerError(null);
                  }}
                  onOpenDueDatePicker={(row) => openDueDatePicker(row.id, row.dueDate)}
                  dueDatePending={dueDatePending}
                />
              );
            })}
          </div>
        )}
      </main>
      <LeaderBoardResourceSlotPickerModal
        isOpen={slotModalOpen}
        onClose={() => setSlotModalOpen(false)}
        candidateResourceCds={resourcesQuery.data?.resources ?? []}
        resourceNameMap={resourceNameMap}
        slotCount={slotCount}
        onSlotCountChange={setSlotCount}
        resourceCdBySlotIndex={resourceCdBySlotIndex}
        assignSlotCd={assignSlotCd}
      />
      <KioskDatePickerModal
        isOpen={isDueDatePickerOpen}
        value={editingDueDateValue}
        onCancel={closeDueDatePicker}
        onCommit={commitDueDate}
      />
    </div>
  );
}
