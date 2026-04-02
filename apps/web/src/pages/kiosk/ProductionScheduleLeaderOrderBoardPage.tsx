import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  useKioskProductionSchedule,
  useKioskProductionScheduleHistoryProgress,
  useKioskProductionScheduleOrderUsage,
  useKioskProductionScheduleResources
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { leaderOrderBoardQueryPageSize } from '../../features/kiosk/leaderOrderBoard/constants';
import {
  filterLeaderBoardRowsByCompletion,
  type LeaderOrderCompletionFilter
} from '../../features/kiosk/leaderOrderBoard/filterLeaderBoardRowsByCompletion';
import { groupRowsByResourceCd } from '../../features/kiosk/leaderOrderBoard/groupRowsByResourceCd';
import { LeaderBoardResourceSlotPickerModal } from '../../features/kiosk/leaderOrderBoard/LeaderBoardResourceSlotPickerModal';
import { LeaderOrderResourceCard } from '../../features/kiosk/leaderOrderBoard/LeaderOrderResourceCard';
import {
  buildSeibanMachineNameMapFromProgressBySeiban,
  mergeMachineNameFallback
} from '../../features/kiosk/leaderOrderBoard/mergeMachineNameFallback';
import { normalizeLeaderBoardRows } from '../../features/kiosk/leaderOrderBoard/normalizeLeaderBoardRow';
import { sortLeaderBoardRowsForDisplay } from '../../features/kiosk/leaderOrderBoard/sortLeaderBoardRowsForDisplay';
import { useLeaderBoardResourceSlots } from '../../features/kiosk/leaderOrderBoard/useLeaderBoardResourceSlots';
import { useManualOrderPageController } from '../../features/kiosk/productionSchedule/useManualOrderPageController';
import { useMutationFeedback } from '../../features/kiosk/productionSchedule/useMutationFeedback';
import { useProductionScheduleMutations } from '../../features/kiosk/productionSchedule/useProductionScheduleMutations';
import { useProductionScheduleQueryParams } from '../../features/kiosk/productionSchedule/useProductionScheduleQueryParams';
import { useProductionScheduleSearchConditionsWithStorageKey } from '../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions';
import { KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS } from '../../hooks/kioskRevealUi';
import { useKioskLeftEdgeDrawerReveal } from '../../hooks/useKioskLeftEdgeDrawerReveal';
import { isMacEnvironment } from '../../lib/client-key/resolver';

import type { ProductionScheduleRow } from '../../api/client';
import type { LeaderBoardRow } from '../../features/kiosk/leaderOrderBoard/types';

const LEADER_ORDER_BOARD_SEARCH_STORAGE_KEY = 'leader-order-board-search-conditions';

const MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED =
  import.meta.env.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED !== 'false';

export function ProductionScheduleLeaderOrderBoardPage() {
  const queryClient = useQueryClient();
  const isMac = typeof window !== 'undefined' ? isMacEnvironment(window.navigator.userAgent) : false;
  const macManualOrderV2 = isMac && MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED;

  const { siteKey, defaultSites, deviceCards, handleSiteChange } = useManualOrderPageController();
  const [activeDeviceScopeKey, setActiveDeviceScopeKey] = useState('');
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

  const searchStateMutation = { isPending: false };
  const {
    pauseRefetch: mutationPauseRefetch,
    orderPending,
    dueDatePending,
    completePending,
    commitDueDate: commitDueDateMutation,
    updateOrder,
    completeRow
  } = useProductionScheduleMutations({
    isSearchStateWriting: searchStateMutation.isPending,
    noteMaxLength: 100,
    productionScheduleTargetDeviceScopeKey: targetDeviceScopeKey,
    productionScheduleOrderCachePolicy: 'leaderBoardFastPath'
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

  const writePause =
    mutationPauseRefetch || orderPending || dueDatePending || completePending;

  const resourcesQuery = useKioskProductionScheduleResources({
    pauseRefetch: writePause
  });

  const scheduleQuery = useKioskProductionSchedule(scheduleListParams, {
    enabled: scheduleEnabled,
    pauseRefetch: writePause
  });

  const orderUsageQuery = useKioskProductionScheduleOrderUsage(
    activeResourceCds.length > 0 ? activeResourceCds.join(',') : undefined,
    {
      pauseRefetch: writePause,
      enabled: scheduleEnabled && activeResourceCds.length > 0,
      ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
        ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
        : {})
    }
  );

  const historyProgressQuery = useKioskProductionScheduleHistoryProgress({
    pauseRefetch: writePause
  });

  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data]
  );

  const drawerReveal = useKioskLeftEdgeDrawerReveal(true);

  const grouped = useMemo(() => {
    const rows = (scheduleQuery.data?.rows ?? []) as ProductionScheduleRow[];
    const normalized = normalizeLeaderBoardRows(rows);
    const fb = buildSeibanMachineNameMapFromProgressBySeiban(historyProgressQuery.data?.progressBySeiban);
    const merged = mergeMachineNameFallback(normalized, fb);
    return groupRowsByResourceCd(merged);
  }, [scheduleQuery.data?.rows, historyProgressQuery.data?.progressBySeiban]);

  const [completionFilter, setCompletionFilter] = useState<LeaderOrderCompletionFilter>('all');

  const sortedGrouped = useMemo(() => {
    const m = new Map<string, LeaderBoardRow[]>();
    grouped.forEach((list, cd) => {
      const filtered = filterLeaderBoardRowsByCompletion(list, completionFilter);
      m.set(cd, sortLeaderBoardRowsForDisplay(filtered));
    });
    return m;
  }, [grouped, completionFilter]);

  const listIncomplete =
    scheduleQuery.data != null && scheduleQuery.data.total > scheduleQuery.data.rows.length;

  const [selectedResourceCd, setSelectedResourceCd] = useState<string | null>(null);
  const [slotModalOpen, setSlotModalOpen] = useState(false);

  const handleOrderChange = useCallback(
    (row: LeaderBoardRow, nextValue: string) => {
      updateOrder({ rowId: row.id, resourceCd: row.resourceCd, nextValue });
    },
    [updateOrder]
  );

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
            'pointer-events-auto flex h-full w-64 max-w-[85vw] flex-col gap-2 border-r border-white/10 bg-slate-900/95 p-3 shadow-xl backdrop-blur-md',
            KIOSK_REVEAL_TRANSFORM_TRANSITION_CLASS,
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
          <div className="flex flex-wrap gap-2 text-[10px] text-white/70">
            <span className="w-full text-[9px] uppercase tracking-wide text-white/45">表示</span>
            {(
              [
                ['all', '両方'],
                ['incomplete', '未完'],
                ['complete', '完了']
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setCompletionFilter(key)}
                className={clsx(
                  'rounded border px-2 py-1',
                  completionFilter === key
                    ? 'border-violet-400/50 bg-violet-500/20 text-violet-100'
                    : 'border-white/20 text-white/70'
                )}
              >
                {label}
              </button>
            ))}
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
            <p className="text-xs text-amber-200/90">
              一覧が1ページに収まっていません。一部の行が表示されないことがあります。
            </p>
          ) : null}
          <div className="mt-auto text-[10px] text-white/40">
            順位は各行のドロップダウンで保存。「-」で納期順の自動並びへ。
          </div>
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
                  }}
                  onOpenDueDatePicker={(row) => openDueDatePicker(row.id, row.dueDate)}
                  dueDatePending={dueDatePending}
                  orderUsageByResourceCd={orderUsageQuery.data}
                  onOrderChange={handleOrderChange}
                  onCompleteRow={(rowId) => void completeRow(rowId)}
                  completePending={completePending}
                  orderPending={orderPending}
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
