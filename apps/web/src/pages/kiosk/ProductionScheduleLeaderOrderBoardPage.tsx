import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  useKioskProductionScheduleHistoryProgress,
  useKioskProductionScheduleOrderUsage,
  useKioskProductionScheduleResources
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { KioskKeyboardModal } from '../../components/kiosk/KioskKeyboardModal';
import { KioskNoteModal } from '../../components/kiosk/KioskNoteModal';
import { buildLeaderBoardGroupedRows, buildLeaderBoardSortedGrouped } from '../../features/kiosk/leaderOrderBoard/buildLeaderBoardViewModel';
import { LEADER_ORDER_BOARD_SHELL_PAGE_SIZE } from '../../features/kiosk/leaderOrderBoard/constants';
import { deriveVisibleSeibanEntries } from '../../features/kiosk/leaderOrderBoard/deriveVisibleSeibanEntries';
import { LeaderBoardGrid } from '../../features/kiosk/leaderOrderBoard/LeaderBoardGrid';
import { LeaderBoardLeftToolStack } from '../../features/kiosk/leaderOrderBoard/LeaderBoardLeftToolStack';
import { LeaderBoardResourceSlotPickerModal } from '../../features/kiosk/leaderOrderBoard/LeaderBoardResourceSlotPickerModal';
import { LeaderBoardSeibanListPanel } from '../../features/kiosk/leaderOrderBoard/LeaderBoardSeibanListPanel';
import {
  LEADER_BOARD_HISTORY_PROGRESS_REFETCH_MS,
  LEADER_BOARD_ORDER_USAGE_REFETCH_MS,
  LEADER_BOARD_RESOURCES_REFETCH_MS,
  LEADER_BOARD_SCHEDULE_REFETCH_MS,
  LEADER_BOARD_SEARCH_STATE_REFETCH_MS
} from '../../features/kiosk/leaderOrderBoard/performance/leaderBoardRefetchPolicy';
import { buildSeibanRankMapFromMergedOrder } from '../../features/kiosk/leaderOrderBoard/seibanPriority/buildSeibanRankMap';
import { useCompositeLeaderboardPhasedScheduleWithAutoAppend } from '../../features/kiosk/leaderOrderBoard/useCompositeLeaderboardPhasedScheduleWithAutoAppend';
import { useLeaderBoardDueAssist } from '../../features/kiosk/leaderOrderBoard/useLeaderBoardDueAssist';
import { useLeaderBoardResourceSlotsWithServerSync } from '../../features/kiosk/leaderOrderBoard/useLeaderBoardResourceSlotsWithServerSync';
import { useLeaderOrderBoardDeviceContext } from '../../features/kiosk/leaderOrderBoard/useLeaderOrderBoardDeviceContext';
import { usePersistedLeaderBoardDeviceScope } from '../../features/kiosk/leaderOrderBoard/usePersistedLeaderBoardDeviceScope';
import { usePersistedLeaderBoardSeibanEval } from '../../features/kiosk/leaderOrderBoard/usePersistedLeaderBoardSeibanEval';
import { useMutationFeedback } from '../../features/kiosk/productionSchedule/useMutationFeedback';
import { useProductionScheduleMutations } from '../../features/kiosk/productionSchedule/useProductionScheduleMutations';
import { useProductionScheduleQueryParams } from '../../features/kiosk/productionSchedule/useProductionScheduleQueryParams';
import { useProductionScheduleSearchConditionsWithStorageKey } from '../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions';
import { KIOSK_DATE_PICKER_OVERLAY_Z_ABOVE_LEFT_STACK } from '../../hooks/kioskRevealUi';
import { useKioskLeftEdgeDrawerReveal } from '../../hooks/useKioskLeftEdgeDrawerReveal';
import { isMacEnvironment } from '../../lib/client-key/resolver';

import type { ProductionScheduleRow } from '../../api/client';
import type { KioskResourceProgressProcessChip } from '../../components/kiosk/resourceProgress/KioskResourceProcessChips';
import type { LeaderOrderCompletionFilter } from '../../features/kiosk/leaderOrderBoard/filterLeaderBoardRowsByCompletion';
import type { LeaderBoardRow } from '../../features/kiosk/leaderOrderBoard/types';

const LEADER_ORDER_BOARD_SEARCH_STORAGE_KEY = 'leader-order-board-search-conditions';

const MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED =
  import.meta.env.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED !== 'false';

function getLeaderBoardPageDebugRunId() {
  if (typeof window === 'undefined') return `leaderboard-page-server-${Date.now()}`;
  const key = 'cursor-debug-leaderboard-page-run-id';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = `leaderboard-page-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

function postLeaderBoardPageDebugLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown>
) {
  if (typeof window === 'undefined') return;
  // #region agent log
  fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'dd2d0f' },
    body: JSON.stringify({
      sessionId: 'dd2d0f',
      runId: getLeaderBoardPageDebugRunId(),
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
}

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

  const leaderboardPhasedBase = useMemo(() => {
    const { resourceCds: _omitResourceCds, ...rest } = baseQueryParams;
    void _omitResourceCds;
    return {
      ...rest,
      pageSize: LEADER_ORDER_BOARD_SHELL_PAGE_SIZE,
      allowResourceOnly: true,
      ...(macManualOrderV2 && activeDeviceScopeKey.trim().length > 0
        ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() }
        : {})
    };
  }, [activeDeviceScopeKey, baseQueryParams, macManualOrderV2]);

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

  const {
    scheduleQuery,
    appendError,
    listIncomplete
  } = useCompositeLeaderboardPhasedScheduleWithAutoAppend({
    leaderboardPhasedBaseParams: leaderboardPhasedBase,
    resourceCdsOrdered: activeResourceCds,
    scheduleEnabled,
    pauseRefetch: writePause,
    refetchIntervalMs: LEADER_BOARD_SCHEDULE_REFETCH_MS,
    macManualOrderV2,
    activeDeviceScopeKey
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
    enabled: scheduleEnabled,
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
  const {
    seibanEvalEnabled,
    setSeibanEvalEnabled,
    mergedRegisteredSeibanOrder,
    moveRegisteredSeibanToRank
  } = usePersistedLeaderBoardSeibanEval(siteKey, activeDeviceScopeKey, dueAssist.sharedHistory);

  const seibanEvalRankMap = useMemo(
    () => buildSeibanRankMapFromMergedOrder(mergedRegisteredSeibanOrder),
    [mergedRegisteredSeibanOrder]
  );

  const toggleSeibanEvalMode = useCallback(() => {
    setSeibanEvalEnabled((prev) => !prev);
  }, [setSeibanEvalEnabled]);

  const registeredSeibansForLeftPane = useMemo(
    () => (seibanEvalEnabled ? mergedRegisteredSeibanOrder : dueAssist.sharedHistory),
    [dueAssist.sharedHistory, mergedRegisteredSeibanOrder, seibanEvalEnabled]
  );

  const registerSeibanToSharedHistory = dueAssist.registerSeibanToSharedHistory;

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

  const [completionFilter, setCompletionFilter] = useState<LeaderOrderCompletionFilter>('incomplete');

  const sortedGrouped = useMemo(
    () =>
      buildLeaderBoardSortedGrouped(
        grouped,
        completionFilter,
        seibanEvalEnabled ? { kind: 'seibanEval', seibanRank: seibanEvalRankMap } : { kind: 'default' }
      ),
    [grouped, completionFilter, seibanEvalEnabled, seibanEvalRankMap]
  );
  const footerResourceChipsByPartKey = useMemo(() => {
    const raw = scheduleQuery.data?.leaderboardFooterChipsByPartKey;
    if (!raw) return new Map<string, readonly KioskResourceProgressProcessChip[]>();
    return new Map<string, readonly KioskResourceProgressProcessChip[]>(
      Object.entries(raw).map(([k, v]) => [k, v as readonly KioskResourceProgressProcessChip[]])
    );
  }, [scheduleQuery.data?.leaderboardFooterChipsByPartKey]);

  const visibleSeibanEntries = useMemo(() => deriveVisibleSeibanEntries(sortedGrouped), [sortedGrouped]);

  const [selectedResourceCd, setSelectedResourceCd] = useState<string | null>(null);
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [isSeibanListPanelOpen, setIsSeibanListPanelOpen] = useState(false);
  /** 備考モーダル対象行の製番（製番登録ボタン用） */
  const [noteModalTargetFseiban, setNoteModalTargetFseiban] = useState<string | null>(null);

  useEffect(() => {
    if (!isNoteModalOpen) setNoteModalTargetFseiban(null);
  }, [isNoteModalOpen]);

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
      setNoteModalTargetFseiban(row.fseiban.trim() ? row.fseiban.trim() : null);
      startNoteEdit(row.id, row.note);
    },
    [startNoteEdit]
  );

  const handleRegisterSeibanFromNoteModal = useCallback(async () => {
    const f = noteModalTargetFseiban?.trim();
    if (!f) return;
    try {
      await registerSeibanToSharedHistory(f);
      closeNoteModal();
    } catch {
      /* 共有履歴保存失敗時はモーダルを開いたまま */
    }
  }, [closeNoteModal, noteModalTargetFseiban, registerSeibanToSharedHistory]);

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
  const scheduleEnabledKey = useMemo(
    () => `${activeDeviceScopeKey}\0${activeResourceCds.join(',')}`,
    [activeDeviceScopeKey, activeResourceCds]
  );
  const boardEnabledAtRef = useRef<number | null>(null);
  const firstRowsLoggedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!scheduleEnabled) {
      boardEnabledAtRef.current = null;
      firstRowsLoggedKeyRef.current = null;
      return;
    }
    boardEnabledAtRef.current = performance.now();
    firstRowsLoggedKeyRef.current = null;
    // #region agent log
    postLeaderBoardPageDebugLog(
      'H3',
      'ProductionScheduleLeaderOrderBoardPage.tsx:schedule-enabled',
      'leaderboard page schedule enabled',
      {
        activeDeviceScopeKey,
        activeResourceCds,
        macManualOrderV2
      }
    );
    // #endregion
  }, [activeDeviceScopeKey, activeResourceCds, macManualOrderV2, scheduleEnabled, scheduleEnabledKey]);

  useEffect(() => {
    const rowCount = scheduleQuery.data?.rows.length ?? 0;
    if (!scheduleEnabled || rowCount === 0) return;
    if (firstRowsLoggedKeyRef.current === scheduleEnabledKey) return;
    firstRowsLoggedKeyRef.current = scheduleEnabledKey;
    // #region agent log
    postLeaderBoardPageDebugLog(
      'H3',
      'ProductionScheduleLeaderOrderBoardPage.tsx:first-rows-visible',
      'leaderboard page first rows rendered',
      {
        activeDeviceScopeKey,
        activeResourceCds,
        rowCount,
        sortedGroupCount: sortedGrouped.size,
        listIncomplete,
        gridReady,
        elapsedSinceEnabledMs:
          boardEnabledAtRef.current == null ? null : Math.round(performance.now() - boardEnabledAtRef.current)
      }
    );
    // #endregion
  }, [
    activeDeviceScopeKey,
    activeResourceCds,
    gridReady,
    listIncomplete,
    scheduleEnabled,
    scheduleEnabledKey,
    scheduleQuery.data?.rows.length,
    sortedGrouped.size
  ]);

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
          isSeibanListPanelOpen={isSeibanListPanelOpen}
          onToggleSeibanListPanel={() => setIsSeibanListPanelOpen((open) => !open)}
          seibanEvalEnabled={seibanEvalEnabled}
          onToggleSeibanEval={toggleSeibanEvalMode}
          registeredSeibansForDisplay={registeredSeibansForLeftPane}
          onMoveRegisteredSeibanToRank={moveRegisteredSeibanToRank}
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
          <>
            {appendError != null ? (
              <p className="mb-2 shrink-0 text-sm text-amber-200" role="alert">
                順位一覧の追補取得に失敗しました（{appendError.message}）。表示は一部のみの可能性があります。少し待ってから再読み込みしてください。
              </p>
            ) : null}
            <LeaderBoardGrid
            resourceCdBySlotIndex={resourceCdBySlotIndex}
            sortedGrouped={sortedGrouped}
            resourceNameMap={resourceNameMap}
            orderUsageByResourceCd={orderUsageQuery.data}
            activeSeibanFilters={searchConditions.activeQueries}
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
            footerResourceChipsByPartKey={footerResourceChipsByPartKey}
            />
          </>
        )}
      </main>
      <LeaderBoardSeibanListPanel
        isOpen={isSeibanListPanelOpen}
        onClose={() => setIsSeibanListPanelOpen(false)}
        entries={visibleSeibanEntries}
        sharedHistory={dueAssist.sharedHistory}
        historyWriting={dueAssist.historyWriting}
        onToggle={(fseiban) => void dueAssist.toggleSeibanInSharedHistory(fseiban)}
      />
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
        extraAction={{
          label: '製番登録',
          disabled:
            dueAssist.historyWriting || !(noteModalTargetFseiban?.trim().length),
          onClick: handleRegisterSeibanFromNoteModal
        }}
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
