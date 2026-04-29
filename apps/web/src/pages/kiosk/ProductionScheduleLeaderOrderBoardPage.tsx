import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  useKioskProductionSchedule,
  useKioskProductionScheduleHistoryProgress,
  useKioskProductionScheduleOrderUsage,
  useKioskProductionScheduleResources
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { KioskKeyboardModal } from '../../components/kiosk/KioskKeyboardModal';
import { KioskNoteModal } from '../../components/kiosk/KioskNoteModal';
import { buildLeaderBoardGroupedRows, buildLeaderBoardSortedGrouped } from '../../features/kiosk/leaderOrderBoard/buildLeaderBoardViewModel';
import { leaderOrderBoardQueryPageSize } from '../../features/kiosk/leaderOrderBoard/constants';
import { LeaderBoardGrid } from '../../features/kiosk/leaderOrderBoard/LeaderBoardGrid';
import { LeaderBoardLeftToolStack } from '../../features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack';
import { LeaderBoardResourceSlotPickerModal } from '../../features/kiosk/leaderOrderBoard/LeaderBoardResourceSlotPickerModal';
import {
  LEADER_BOARD_HISTORY_PROGRESS_REFETCH_MS,
  LEADER_BOARD_ORDER_USAGE_REFETCH_MS,
  LEADER_BOARD_RESOURCES_REFETCH_MS,
  LEADER_BOARD_SCHEDULE_REFETCH_MS,
  LEADER_BOARD_SEARCH_STATE_REFETCH_MS
} from '../../features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy';
import { useLeaderBoardDueAssist } from '../../features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist';
import { useLeaderBoardResourceSlotsWithServerSync } from '../../features/kiosk/leaderOrderBoard/useLeaderBoardResourceSlotsWithServerSync';
import { useLeaderOrderBoardDeviceContext } from '../../features/kiosk/leaderOrderBoard/useLeaderOrderBoardDeviceContext';
import { usePersistedLeaderBoardDeviceScope } from '../../features/kiosk/leaderOrderBoard/usePersistedLeaderBoardDeviceScope';
import { useMutationFeedback } from '../../features/kiosk/productionSchedule/useMutationFeedback';
import { useProductionScheduleMutations } from '../../features/kiosk/productionSchedule/useProductionScheduleMutations';
import { useProductionScheduleQueryParams } from '../../features/kiosk/productionSchedule/useProductionScheduleQueryParams';
import { useProductionScheduleSearchConditionsWithStorageKey } from '../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions';
import { KIOSK_DATE_PICKER_OVERLAY_Z_ABOVE_LEFT_STACK } from '../../hooks/kioskRevealUi';
import { useKioskLeftEdgeDrawerReveal } from '../../hooks/useKioskLeftEdgeDrawerReveal';
import { isMacEnvironment } from '../../lib/client-key/resolver';

import type { ProductionScheduleRow } from '../../api/client';
import type { LeaderOrderCompletionFilter } from '../../features/kiosk/leaderOrderBoard/filterLeaderBoardRowsByCompletion';
import type { LeaderBoardRow } from '../../features/kiosk/leaderOrderBoard/types';

const LEADER_ORDER_BOARD_SEARCH_STORAGE_KEY = 'leader-order-board-search-conditions';

const MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED =
  import.meta.env.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED !== 'false';

export function ProductionScheduleLeaderOrderBoardPage() {
  const queryClient = useQueryClient();
  const isMac = typeof window !== 'undefined' ? isMacEnvironment(window.navigator.userAgent) : false;
  const macManualOrderV2 = isMac && MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED;

  const { siteKey, defaultSites, deviceCards, handleSiteChange, resourceAssignmentsQuery } =
    useLeaderOrderBoardDeviceContext();
  const validDeviceScopeKeys = useMemo(() => deviceCards.map((d) => d.deviceScopeKey.trim()), [deviceCards]);
  const { activeDeviceScopeKey, setActiveDeviceScopeKey } = usePersistedLeaderBoardDeviceScope(siteKey, validDeviceScopeKeys);
  const [searchConditions, setSearchConditions] = useProductionScheduleSearchConditionsWithStorageKey(
    LEADER_ORDER_BOARD_SEARCH_STORAGE_KEY
  );

  useEffect(() => {
    if (!searchConditions.showGrindingResources && !searchConditions.showCuttingResources) {
      setSearchConditions({ showGrindingResources: true, showCuttingResources: true });
    }
  }, [searchConditions.showGrindingResources, searchConditions.showCuttingResources, setSearchConditions]);

  const assignedResourceCds = useMemo(() => {
    const device = deviceCards.find((d) => d.deviceScopeKey.trim() === activeDeviceScopeKey.trim());
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

  const resourceAssignmentRowForDevice = useMemo(
    () =>
      resourceAssignmentsQuery.data?.assignments?.find(
        (a) => a.deviceScopeKey.trim() === activeDeviceScopeKey.trim()
      ),
    [activeDeviceScopeKey, resourceAssignmentsQuery.data?.assignments]
  );

  const serverOrderedResourceCds =
    resourceAssignmentsQuery.isSuccess && activeDeviceScopeKey.trim().length > 0
      ? (resourceAssignmentRowForDevice?.resourceCds ?? [])
      : undefined;

  const assignmentsSyncEnabled =
    Boolean(siteKey.trim()) && Boolean(activeDeviceScopeKey.trim()) && resourceAssignmentsQuery.isSuccess;

  const { slotCount, setSlotCount, resourceCdBySlotIndex, assignSlotCd, activeResourceCds } =
    useLeaderBoardResourceSlotsWithServerSync({
      scopeKey: slotsScopeKey,
      fallbackAssignedResourceCds: assignedResourceCds,
      siteKey,
      deviceScopeKey: activeDeviceScopeKey,
      serverOrderedResourceCds,
      assignmentsQuerySuccess: resourceAssignmentsQuery.isSuccess,
      enabled: assignmentsSyncEnabled
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
      responseProfile: 'leaderboard' as const,
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
    notePending,
    commitDueDate: commitDueDateMutation,
    updateOrder,
    completeRow,
    saveNote
  } = useProductionScheduleMutations({
    isSearchStateWriting: searchStateMutation.isPending,
    noteMaxLength: 100,
    productionScheduleTargetDeviceScopeKey: targetDeviceScopeKey,
    productionScheduleOrderCachePolicy: 'leaderBoardFastPath'
  });

  const invalidateScheduleQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule'] }),
      queryClient.invalidateQueries({
        queryKey: ['kiosk-production-schedule-due-management-manual-order-overview']
      }),
      queryClient.invalidateQueries({ queryKey: ['kiosk-production-schedule-manual-order-resource-assignments'] })
    ]);

  const {
    editingNoteValue,
    isNoteModalOpen,
    startNoteEdit,
    commitNote,
    closeNoteModal,
    editingDueDateValue,
    isDueDatePickerOpen,
    openDueDatePicker,
    commitDueDate,
    closeDueDatePicker
  } = useMutationFeedback({
    onCommitNote: ({ rowId, note, onSettled }) => {
      saveNote({
        rowId,
        note,
        onSettled: () => {
          void invalidateScheduleQueries().finally(onSettled);
        }
      });
    },
    onCommitDueDate: ({ rowId, dueDate, onSettled }) => {
      commitDueDateMutation({
        rowId,
        dueDate,
        onSettled: () => {
          void invalidateScheduleQueries().finally(onSettled);
        }
      });
    }
  });

  const scheduleEnabled =
    activeDeviceScopeKey.trim().length > 0 &&
    hasResourceCategoryResourceSelection &&
    activeResourceCds.length > 0;

  const writePause =
    mutationPauseRefetch || orderPending || dueDatePending || completePending || notePending;

  const resourcesQuery = useKioskProductionScheduleResources({
    pauseRefetch: writePause,
    refetchIntervalMs: LEADER_BOARD_RESOURCES_REFETCH_MS
  });

  const scheduleQuery = useKioskProductionSchedule(scheduleListParams, {
    enabled: scheduleEnabled,
    pauseRefetch: writePause,
    refetchIntervalMs: LEADER_BOARD_SCHEDULE_REFETCH_MS
  });

  const orderUsageQuery = useKioskProductionScheduleOrderUsage(
    activeResourceCds.length > 0 ? activeResourceCds.join(',') : undefined,
    {
      pauseRefetch: writePause,
      enabled: scheduleEnabled && activeResourceCds.length > 0,
      refetchIntervalMs: LEADER_BOARD_ORDER_USAGE_REFETCH_MS,
      ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
        ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
        : {})
    }
  );

  const historyProgressQuery = useKioskProductionScheduleHistoryProgress({
    pauseRefetch: writePause,
    refetchIntervalMs: LEADER_BOARD_HISTORY_PROGRESS_REFETCH_MS
  });

  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data]
  );

  const dueAssist = useLeaderBoardDueAssist({
    pauseRefetch: writePause,
    refetchIntervalMs: LEADER_BOARD_SEARCH_STATE_REFETCH_MS,
    initialSeibanFilters: searchConditions.activeQueries
  });

  /** 製番フィルタ ⇔ searchConditions.activeQueries（順位ボード専用 localStorage）。
   * サーバ共有履歴との同期は {@link useLeaderBoardDueAssist} 側（検索確定・フィルタON・初回ハイドレート）。 */
  useEffect(() => {
    const next = dueAssist.selectedFseibanFilters;
    setSearchConditions((prev) => {
      const a = prev.activeQueries;
      if (a.length === next.length && next.every((v, i) => a[i] === v)) return prev;
      return { ...prev, activeQueries: [...next] };
    });
  }, [dueAssist.selectedFseibanFilters, setSearchConditions]);

  const drawerReveal = useKioskLeftEdgeDrawerReveal(true, { keepOpen: dueAssist.isDetailOpen });
  const leftToolStackOuterRef = useRef<HTMLDivElement | null>(null);
  const [leftStackWidthPx, setLeftStackWidthPx] = useState(0);

  useLayoutEffect(() => {
    const el = leftToolStackOuterRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setLeftStackWidthPx(Math.round(el.getBoundingClientRect().width));
    });
    ro.observe(el);
    setLeftStackWidthPx(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, [dueAssist.isDetailOpen]);
  const [isSearchKeyboardOpen, setIsSearchKeyboardOpen] = useState(false);
  const [searchKeyboardValue, setSearchKeyboardValue] = useState('');

  const openSearchKeyboard = () => {
    setSearchKeyboardValue(dueAssist.searchInput);
    setIsSearchKeyboardOpen(true);
  };
  const confirmSearchKeyboard = () => {
    dueAssist.setSearchInput(searchKeyboardValue);
    setIsSearchKeyboardOpen(false);
  };

  const isDueAssistDetailOpen = dueAssist.isDetailOpen;
  const closeDueAssistDetail = dueAssist.closeDetail;
  useEffect(() => {
    if (!isDueAssistDetailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDueAssistDetail();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isDueAssistDetailOpen, closeDueAssistDetail]);

  const grouped = useMemo(() => {
    const rows = (scheduleQuery.data?.rows ?? []) as ProductionScheduleRow[];
    return buildLeaderBoardGroupedRows(rows, historyProgressQuery.data?.progressBySeiban);
  }, [scheduleQuery.data?.rows, historyProgressQuery.data?.progressBySeiban]);

  const [completionFilter, setCompletionFilter] = useState<LeaderOrderCompletionFilter>('all');

  const sortedGrouped = useMemo(
    () => buildLeaderBoardSortedGrouped(grouped, completionFilter),
    [grouped, completionFilter]
  );

  const listIncomplete =
    scheduleQuery.data != null && scheduleQuery.data.total > scheduleQuery.data.rows.length;

  const [selectedResourceCd, setSelectedResourceCd] = useState<string | null>(null);
  const [slotModalOpen, setSlotModalOpen] = useState(false);

  useEffect(() => {
    if (selectedResourceCd == null) return;
    if (activeResourceCds.includes(selectedResourceCd)) return;
    setSelectedResourceCd(null);
  }, [activeResourceCds, selectedResourceCd]);

  const handleOrderChange = useCallback(
    (row: LeaderBoardRow, nextValue: string) => {
      updateOrder({ rowId: row.id, resourceCd: row.resourceCd, nextValue });
    },
    [updateOrder]
  );

  const handleOpenRowDueDate = useCallback(
    (row: LeaderBoardRow) => {
      openDueDatePicker(row.id, row.dueDate);
    },
    [openDueDatePicker]
  );

  const handleOpenRowNote = useCallback(
    (row: LeaderBoardRow) => {
      startNoteEdit(row.id, row.note);
    },
    [startNoteEdit]
  );

  const handleCompleteRow = useCallback(
    (rowId: string) => {
      void completeRow(rowId);
    },
    [completeRow]
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
        <LeaderBoardLeftToolStack
          leftToolStackOuterRef={leftToolStackOuterRef}
          drawerReveal={drawerReveal}
          siteKey={siteKey}
          defaultSites={defaultSites}
          handleSiteChange={handleSiteChange}
          activeDeviceScopeKey={activeDeviceScopeKey}
          setActiveDeviceScopeKey={setActiveDeviceScopeKey}
          setSelectedResourceCd={setSelectedResourceCd}
          deviceCards={deviceCards}
          dueAssist={dueAssist}
          openSearchKeyboard={openSearchKeyboard}
          searchConditions={searchConditions}
          toggleGrinding={toggleGrinding}
          toggleCutting={toggleCutting}
          completionFilter={completionFilter}
          setCompletionFilter={setCompletionFilter}
          selectedResourceCategory={selectedResourceCategory}
          activeResourceCds={activeResourceCds}
          slotCount={slotCount}
          setSlotModalOpen={setSlotModalOpen}
          selectedResourceCd={selectedResourceCd}
          listIncomplete={listIncomplete}
        />
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
          <LeaderBoardGrid
            resourceCdBySlotIndex={resourceCdBySlotIndex}
            sortedGrouped={sortedGrouped}
            resourceNameMap={resourceNameMap}
            orderUsageByResourceCd={orderUsageQuery.data}
            selectedResourceCd={selectedResourceCd}
            setSelectedResourceCd={setSelectedResourceCd}
            onOpenDueDatePicker={handleOpenRowDueDate}
            dueDatePending={dueDatePending}
            onOrderChange={handleOrderChange}
            onCompleteRow={handleCompleteRow}
            completePending={completePending}
            orderPending={orderPending}
            onOpenNote={handleOpenRowNote}
            notePending={notePending}
          />
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
      <KioskNoteModal
        isOpen={isNoteModalOpen}
        value={editingNoteValue}
        maxLength={100}
        onCancel={closeNoteModal}
        onCommit={commitNote}
      />
      <KioskDatePickerModal
        isOpen={isDueDatePickerOpen}
        value={editingDueDateValue}
        onCancel={closeDueDatePicker}
        onCommit={commitDueDate}
      />
      {dueAssist.isDetailOpen ? (
        <div
          className="fixed top-0 right-0 bottom-0 z-40 bg-slate-950/45"
          style={{ left: leftStackWidthPx }}
          onClick={dueAssist.closeDetail}
          aria-hidden
        />
      ) : null}
      <KioskDatePickerModal
        isOpen={dueAssist.isDatePickerOpen}
        value={dueAssist.editingDueDate}
        onCancel={dueAssist.closeDatePicker}
        onCommit={(next) => void dueAssist.commitDueDate(next)}
        overlayZIndex={KIOSK_DATE_PICKER_OVERLAY_Z_ABOVE_LEFT_STACK}
      />
      <KioskKeyboardModal
        isOpen={isSearchKeyboardOpen}
        value={searchKeyboardValue}
        onChange={setSearchKeyboardValue}
        onCancel={() => setIsSearchKeyboardOpen(false)}
        onConfirm={confirmSearchKeyboard}
      />
    </div>
  );
}
