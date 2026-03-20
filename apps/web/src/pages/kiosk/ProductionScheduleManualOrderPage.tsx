import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useKioskProductionSchedule,
  useKioskProductionScheduleHistoryProgress,
  useKioskProductionScheduleOrderUsage,
  useKioskProductionScheduleProcessingTypeOptions,
  useKioskProductionScheduleResources,
  useKioskProductionScheduleSearchState,
  useUpdateKioskProductionScheduleSearchState
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { KioskKeyboardModal } from '../../components/kiosk/KioskKeyboardModal';
import { KioskNoteModal } from '../../components/kiosk/KioskNoteModal';
import { ManualOrderActiveDeviceBanner } from '../../components/kiosk/manualOrder/ManualOrderActiveDeviceBanner';
import { ManualOrderOverviewPane } from '../../components/kiosk/manualOrder/ManualOrderOverviewPane';
import { ManualOrderSiteToolbar } from '../../components/kiosk/manualOrder/ManualOrderSiteToolbar';
import { ProductionOrderSearchModal } from '../../components/kiosk/ProductionOrderSearchModal';
import { ProductionScheduleResourceFilterDropdown } from '../../components/kiosk/ProductionScheduleResourceFilterDropdown';
import { ProductionScheduleResourceFilters } from '../../components/kiosk/ProductionScheduleResourceFilters';
import { ProductionScheduleSeibanFilterDropdown } from '../../components/kiosk/ProductionScheduleSeibanFilterDropdown';
import { ProductionScheduleTable } from '../../components/kiosk/ProductionScheduleTable';
import { ProductionScheduleToolbar } from '../../components/kiosk/ProductionScheduleToolbar';
import { type TableColumnDefinition } from '../../features/kiosk/columnWidth';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';
import {
  KIOSK_PRODUCTION_SCHEDULE_SEARCH_HISTORY_HIDDEN_KEY,
  KIOSK_PRODUCTION_SCHEDULE_SEARCH_HISTORY_KEY
} from '../../features/kiosk/productionSchedule/kioskProductionScheduleSharedStorageKeys';
import { filterResourceCdsByCategory, isGrindingResourceCd } from '../../features/kiosk/productionSchedule/resourceCategory';
import { getResourceColorClasses, ORDER_NUMBERS } from '../../features/kiosk/productionSchedule/resourceColors';
import { prioritizeResourceCdsByPresence } from '../../features/kiosk/productionSchedule/resourcePriority';
import { useManualOrderCardState } from '../../features/kiosk/productionSchedule/useManualOrderCardState';
import { useManualOrderPageController } from '../../features/kiosk/productionSchedule/useManualOrderPageController';
import { useMutationFeedback } from '../../features/kiosk/productionSchedule/useMutationFeedback';
import { useProductionOrderSearch } from '../../features/kiosk/productionSchedule/useProductionOrderSearch';
import { useProductionScheduleDerivedRows } from '../../features/kiosk/productionSchedule/useProductionScheduleDerivedRows';
import { useProductionScheduleMutations } from '../../features/kiosk/productionSchedule/useProductionScheduleMutations';
import { normalizeHistoryList, useProductionScheduleQueryParams } from '../../features/kiosk/productionSchedule/useProductionScheduleQueryParams';
import { useProductionScheduleSearchConditionsWithStorageKey } from '../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions';
import { useSharedSearchHistory } from '../../features/kiosk/productionSchedule/useSharedSearchHistory';
import { useLocalStorage } from '../../hooks/useLocalStorage';

import type { ProductionScheduleSortMode } from '../../features/kiosk/productionSchedule/displayRowDerivation';

const NOTE_MAX_LENGTH = 100;
const MANUAL_ORDER_PAGE_SEARCH_STORAGE_KEY = 'manual-order-page-search-conditions';
const MANUAL_ORDER_PAGE_SORT_MODE_STORAGE_KEY = 'manual-order-page-sort-mode';
const DUE_DATE_COLUMN_WIDTH = 110;
const NOTE_COLUMN_WIDTH = 140;

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function ProductionScheduleManualOrderPage() {
  const {
    siteKey,
    defaultSites,
    deviceCards,
    siteDevicesQuery,
    overviewQuery,
    handleSiteChange
  } = useManualOrderPageController();
  const {
    activeDeviceScopeKey,
    setActiveDeviceScopeKey,
    statusMap,
    setDeviceStatus,
    clearDeviceStatus
  } = useManualOrderCardState(deviceCards.map((device) => device.deviceScopeKey));
  const [activeResourceCdForBanner, setActiveResourceCdForBanner] = useState<string | null>(null);

  const [searchConditions, setSearchConditions, resetSearchConditions] =
    useProductionScheduleSearchConditionsWithStorageKey(MANUAL_ORDER_PAGE_SEARCH_STORAGE_KEY);
  const {
    inputQuery,
    activeQueries,
    activeResourceCds,
    activeResourceAssignedOnlyCds,
    hasNoteOnlyFilter,
    hasDueDateOnlyFilter,
    showGrindingResources,
    showCuttingResources,
    selectedMachineName,
    selectedPartName
  } = searchConditions;
  const [history, setHistory] = useLocalStorage<string[]>(KIOSK_PRODUCTION_SCHEDULE_SEARCH_HISTORY_KEY, []);
  const [, setHiddenHistory] = useLocalStorage<string[]>(
    KIOSK_PRODUCTION_SCHEDULE_SEARCH_HISTORY_HIDDEN_KEY,
    []
  );
  const [sortMode, setSortMode] = useLocalStorage<ProductionScheduleSortMode>(
    MANUAL_ORDER_PAGE_SORT_MODE_STORAGE_KEY,
    'manual'
  );
  const [selectedOrderNumbers, setSelectedOrderNumbers] = useState<string[]>([]);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardValue, setKeyboardValue] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);

  const {
    normalizedActiveQueries,
    normalizedResourceCds,
    normalizedAssignedOnlyCds,
    normalizedHistory,
    visibleHistory,
    selectedResourceCategory,
    queryParams,
    hasQuery
  } = useProductionScheduleQueryParams({
    activeQueries,
    activeResourceCds,
    activeResourceAssignedOnlyCds,
    hasNoteOnlyFilter,
    hasDueDateOnlyFilter,
    showGrindingResources,
    showCuttingResources,
    selectedMachineName,
    selectedOrderNumbers,
    history
  });

  const scheduleListParams = useMemo(
    () => ({
      ...queryParams,
      ...(activeDeviceScopeKey.trim().length > 0 ? { targetDeviceScopeKey: activeDeviceScopeKey.trim() } : {})
    }),
    [activeDeviceScopeKey, queryParams]
  );

  const searchStateMutation = useUpdateKioskProductionScheduleSearchState();
  const {
    completePending,
    orderPending,
    processingPending,
    notePending,
    dueDatePending,
    pauseRefetch,
    updateOrder,
    updateProcessing,
    saveNote,
    commitDueDate: commitDueDateMutation,
    completeRow,
    orderError,
    resetOrderError
  } = useProductionScheduleMutations({
    isSearchStateWriting: searchStateMutation.isPending,
    noteMaxLength: NOTE_MAX_LENGTH,
    productionScheduleTargetDeviceScopeKey:
      activeDeviceScopeKey.trim().length > 0 ? activeDeviceScopeKey.trim() : undefined
  });

  const scheduleQuery = useKioskProductionSchedule(scheduleListParams, {
    enabled: hasQuery && activeDeviceScopeKey.trim().length > 0,
    pauseRefetch
  });
  const resourcesQuery = useKioskProductionScheduleResources({ pauseRefetch });
  const processingTypeOptionsQuery = useKioskProductionScheduleProcessingTypeOptions({ pauseRefetch });
  const searchStateQuery = useKioskProductionScheduleSearchState({ pauseRefetch });
  const historyProgressQuery = useKioskProductionScheduleHistoryProgress({ pauseRefetch });
  const progressBySeiban = useMemo(
    () => historyProgressQuery.data?.progressBySeiban ?? {},
    [historyProgressQuery.data?.progressBySeiban]
  );

  const tableColumns: TableColumnDefinition[] = useMemo(
    () => [
      { key: 'FHINCD', label: '品番' },
      { key: 'ProductNo', label: '製造order番号' },
      { key: 'FHINMEI', label: '品名' },
      { key: 'FSIGENCD', label: '資源CD' },
      { key: 'globalRank', label: '全体順位', dataType: 'number' },
      { key: 'actualPerPieceMinutes', label: '実績基準時間(分/個)', dataType: 'number' },
      { key: 'processingOrder', label: '資源順番', dataType: 'number' },
      { key: 'processingType', label: '処理' },
      { key: 'FSIGENSHOYORYO', label: '所要', dataType: 'number' },
      { key: 'FKOJUN', label: '工順', dataType: 'number' },
      { key: 'FSEIBAN', label: '製番' }
    ],
    []
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;
    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect?.width ?? 0);
      if (nextWidth > 0) {
        setContainerWidth(nextWidth);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const {
    displayRows,
    completedCount,
    incompleteCount,
    resourceCdsInRows,
    manualSortEnabled,
    isDisplayRankContext,
    isTwoColumn,
    itemSeparatorWidth,
    checkWidth,
    itemColumnWidths,
    rowPairs,
    machineNameOptions,
    partNameOptions
  } = useProductionScheduleDerivedRows({
    rows: (scheduleQuery.data?.rows ?? []) as Array<{
      id: string;
      rowData?: unknown;
      processingOrder?: number | null;
      globalRank?: number | null;
      actualPerPieceMinutes?: number | null;
      processingType?: string | null;
      note?: string | null;
      dueDate?: string | null;
    }>,
    tableColumns,
    normalizedResourceCds,
    normalizedAssignedOnlyCds,
    normalizedActiveQueries,
    selectedResourceCategory,
    showGrindingResources,
    showCuttingResources,
    selectedMachineName,
    selectedPartName,
    selectedOrderNumbers,
    sortMode,
    containerWidth
  });

  const isOrderSearchEnabled =
    (showGrindingResources || showCuttingResources) && normalizedResourceCds.length > 0;
  const orderSearch = useProductionOrderSearch({
    enabled: isOrderSearchEnabled,
    resourceCds: normalizedResourceCds,
    resourceCategory: selectedResourceCategory,
    machineName: selectedMachineName,
    onConfirmSelection: (selectedOrders) => {
      setSelectedOrderNumbers(selectedOrders);
    }
  });

  const orderUsageQuery = useKioskProductionScheduleOrderUsage(
    resourceCdsInRows.length > 0 ? resourceCdsInRows.join(',') : undefined,
    {
      pauseRefetch,
      enabled: activeDeviceScopeKey.trim().length > 0,
      targetDeviceScopeKey: activeDeviceScopeKey.trim() || undefined
    }
  );

  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data?.resourceNameMap]
  );
  const getResourceAriaLabel = useCallback(
    (resourceCd: string, suffix?: string) => {
      const names = resourceNameMap[resourceCd] ?? [];
      const base = names.length > 0 ? `${resourceCd}: ${names.join(' / ')}` : resourceCd;
      return suffix ? `${base} ${suffix}` : base;
    },
    [resourceNameMap]
  );

  const visibleResourceCds = useMemo(() => {
    const cuttingExcludedResourceCds = (resourcesQuery.data?.resourceItems ?? [])
      .filter((item) => item.excluded)
      .map((item) => item.resourceCd);
    return filterResourceCdsByCategory(
      resourcesQuery.data?.resources ?? [],
      {
        showGrinding: showGrindingResources,
        showCutting: showCuttingResources
      },
      {
        cuttingExcludedResourceCds
      }
    );
  }, [resourcesQuery.data?.resourceItems, resourcesQuery.data?.resources, showCuttingResources, showGrindingResources]);

  const prioritizedVisibleResourceCds = useMemo(
    () =>
      prioritizeResourceCdsByPresence(
        visibleResourceCds,
        resourceCdsInRows,
        normalizedActiveQueries.length > 0
      ),
    [visibleResourceCds, resourceCdsInRows, normalizedActiveQueries.length]
  );

  const seibanFilterItems = useMemo(
    () =>
      visibleHistory.map((fseiban) => ({
        fseiban,
        machineName: progressBySeiban[fseiban]?.machineName,
        selected: normalizedActiveQueries.includes(fseiban)
      })),
    [normalizedActiveQueries, progressBySeiban, visibleHistory]
  );
  const selectedSeibanCount = useMemo(
    () => seibanFilterItems.filter((item) => item.selected).length,
    [seibanFilterItems]
  );

  const resourceFilterItems = useMemo(
    () =>
      prioritizedVisibleResourceCds.map((resourceCd) => ({
        resourceCd,
        resourceNames: resourceNameMap[resourceCd] ?? [],
        selected: normalizedResourceCds.includes(resourceCd),
        assignedOnlySelected: normalizedAssignedOnlyCds.includes(resourceCd)
      })),
    [normalizedAssignedOnlyCds, normalizedResourceCds, prioritizedVisibleResourceCds, resourceNameMap]
  );
  const selectedResourceCount = useMemo(
    () => resourceFilterItems.filter((item) => item.selected).length,
    [resourceFilterItems]
  );
  const selectedAssignedOnlyCount = useMemo(
    () => resourceFilterItems.filter((item) => item.assignedOnlySelected).length,
    [resourceFilterItems]
  );

  const { updateSharedSearchState } = useSharedSearchHistory({
    normalizedHistory,
    setHistory,
    setHiddenHistory,
    searchStateQuery,
    searchStateMutation
  });

  const {
    editingNoteValue,
    isNoteModalOpen,
    editingDueDateValue,
    isDueDatePickerOpen,
    startNoteEdit,
    commitNote,
    closeNoteModal,
    openDueDatePicker,
    commitDueDate,
    closeDueDatePicker
  } = useMutationFeedback({
    onCommitNote: ({ rowId, note, onSettled }) => {
      saveNote({ rowId, note, onSettled });
    },
    onCommitDueDate: ({ rowId, dueDate, onSettled }) => {
      commitDueDateMutation({ rowId, dueDate, onSettled });
    }
  });

  const applySearch = (value: string) => {
    const trimmed = value.trim();
    setSearchConditions({
      inputQuery: trimmed,
      activeQueries: trimmed.length > 0 ? [trimmed] : []
    });
    if (trimmed.length > 0) {
      const nextHistory = normalizeHistoryList([trimmed, ...normalizedHistory]);
      setHistory(nextHistory);
      setHiddenHistory((prev) => prev.filter((item) => item.trim() !== trimmed));
      void updateSharedSearchState(nextHistory, { type: 'add', value: trimmed });
    }
  };
  const clearAllFilters = () => {
    resetSearchConditions();
    setSelectedOrderNumbers([]);
  };

  const toggleHistoryQuery = (value: string) => {
    setSearchConditions((prev) => {
      const exists = prev.activeQueries.includes(value);
      const next = exists
        ? prev.activeQueries.filter((item) => item !== value)
        : [...prev.activeQueries, value].slice(0, 20);
      return { activeQueries: next };
    });
  };
  const setAllHistoryQueries = (selected: boolean) => {
    setSearchConditions({ activeQueries: selected ? visibleHistory : [] });
  };

  const toggleResourceCd = (value: string) => {
    setSearchConditions((prev) => {
      const exists = prev.activeResourceCds.includes(value);
      const next = exists
        ? prev.activeResourceCds.filter((item) => item !== value)
        : [...prev.activeResourceCds, value];
      return { activeResourceCds: next };
    });
  };
  const toggleAssignedOnlyCd = (value: string) => {
    setSearchConditions((prev) => {
      const exists = prev.activeResourceAssignedOnlyCds.includes(value);
      const next = exists
        ? prev.activeResourceAssignedOnlyCds.filter((item) => item !== value)
        : [...prev.activeResourceAssignedOnlyCds, value];
      return { activeResourceAssignedOnlyCds: next };
    });
  };
  const setAllResourceCds = (selected: boolean) => {
    setSearchConditions({ activeResourceCds: selected ? prioritizedVisibleResourceCds : [] });
  };
  const setAllAssignedOnlyCds = (selected: boolean) => {
    setSearchConditions({
      activeResourceAssignedOnlyCds: selected ? prioritizedVisibleResourceCds : []
    });
  };

  const toggleGrindingResources = () => {
    setSearchConditions((prev) => ({ showGrindingResources: !prev.showGrindingResources }));
  };
  const toggleCuttingResources = () => {
    setSearchConditions((prev) => ({ showCuttingResources: !prev.showCuttingResources }));
  };

  const handleMachineNameChange = (value: string) => {
    setSearchConditions((prev) => ({
      selectedMachineName: value,
      selectedPartName: value === prev.selectedMachineName ? prev.selectedPartName : ''
    }));
  };
  const handlePartNameChange = (value: string) => {
    setSearchConditions({ selectedPartName: value });
  };

  useEffect(() => {
    if (!selectedResourceCategory) return;
    const shouldKeepResourceCd = (resourceCd: string) => {
      const isGrinding = isGrindingResourceCd(resourceCd);
      return selectedResourceCategory === 'grinding' ? isGrinding : !isGrinding;
    };
    setSearchConditions((prev) => ({
      activeResourceCds: prev.activeResourceCds.filter(shouldKeepResourceCd),
      activeResourceAssignedOnlyCds: prev.activeResourceAssignedOnlyCds.filter(shouldKeepResourceCd)
    }));
  }, [selectedResourceCategory, setSearchConditions]);

  useEffect(() => {
    if (selectedMachineName.trim().length === 0) {
      if (selectedPartName.trim().length === 0) return;
      setSearchConditions({ selectedPartName: '' });
      return;
    }
    if (selectedPartName.trim().length > 0 && !partNameOptions.includes(selectedPartName)) {
      setSearchConditions({ selectedPartName: '' });
    }
  }, [partNameOptions, selectedMachineName, selectedPartName, setSearchConditions]);

  const getAvailableOrders = (resourceCd: string, current: number | null) => {
    const usage = orderUsageQuery.data?.[resourceCd] ?? [];
    return ORDER_NUMBERS.filter((num) => num === current || !usage.includes(num));
  };

  const handleOrderChange = (rowId: string, resourceCd: string, nextValue: string) => {
    if (!activeDeviceScopeKey) return;
    setDeviceStatus(activeDeviceScopeKey, 'saving');
    resetOrderError();
    updateOrder({ rowId, resourceCd, nextValue });
  };

  const handleProcessingChange = (rowId: string, nextValue: string) => {
    updateProcessing(rowId, nextValue);
  };

  const openKeyboard = () => {
    setKeyboardValue(inputQuery);
    setIsKeyboardOpen(true);
  };
  const confirmKeyboard = () => {
    setSearchConditions({ inputQuery: keyboardValue });
    setIsKeyboardOpen(false);
  };

  useEffect(() => {
    if (!activeDeviceScopeKey) return;
    if (orderPending) {
      setDeviceStatus(activeDeviceScopeKey, 'saving');
      return;
    }
    if (orderError) {
      setDeviceStatus(activeDeviceScopeKey, 'error');
      return;
    }
    clearDeviceStatus(activeDeviceScopeKey);
  }, [activeDeviceScopeKey, clearDeviceStatus, orderError, orderPending, setDeviceStatus]);

  useEffect(() => {
    const current = deviceCards.find((device) => device.deviceScopeKey === activeDeviceScopeKey);
    if (!current || current.resources.length === 0) {
      setActiveResourceCdForBanner(null);
      return;
    }
    setActiveResourceCdForBanner(current.resources[0]?.resourceCd ?? null);
  }, [activeDeviceScopeKey, deviceCards]);

  const handleSelectDevice = (deviceScopeKey: string) => {
    setActiveDeviceScopeKey(deviceScopeKey);
    const nextEl = document.querySelector<HTMLElement>(`[data-device-scope-key="${deviceScopeKey}"]`);
    if (nextEl) {
      nextEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
    const main = containerRef.current?.querySelector('.manual-order-lower-pane-scroll');
    if (main instanceof HTMLElement) {
      main.scrollTop = 0;
    }
  };

  const activeDeviceLabel = useMemo(() => {
    const matched = deviceCards.find((device) => device.deviceScopeKey === activeDeviceScopeKey);
    if (!matched) return '';
    return matched.label;
  }, [activeDeviceScopeKey, deviceCards]);

  const canShowSchedule = activeDeviceScopeKey.trim().length > 0;
  const lowerPaneStatusMessage = !canShowSchedule
    ? '上ペインの鉛筆から編集対象端末を選択してください。'
    : scheduleQuery.isFetching
      ? '読み込み中…'
      : orderError
        ? '保存に失敗しました。再度お試しください。'
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" ref={containerRef}>
      <div className="grid min-h-0 flex-1 grid-rows-[0.95fr_1.25fr] gap-2">
        <div className="min-h-0 overflow-hidden">
          <ManualOrderActiveDeviceBanner
            visible={Boolean(activeDeviceScopeKey)}
            label={activeDeviceLabel}
            resourceCd={activeResourceCdForBanner}
          />
          <div className="h-[calc(100%-2.2rem)] min-h-0">
            <ManualOrderOverviewPane
              siteToolbar={
                <ManualOrderSiteToolbar
                  siteKey={siteKey}
                  defaultSites={defaultSites}
                  onSiteChange={(next) => {
                    setActiveDeviceScopeKey('');
                    handleSiteChange(next);
                  }}
                />
              }
              devices={deviceCards}
              activeDeviceScopeKey={activeDeviceScopeKey}
              statusMap={statusMap}
              onSelectDevice={handleSelectDevice}
              isLoading={siteDevicesQuery.isLoading || overviewQuery.isLoading}
              isError={siteDevicesQuery.isError || overviewQuery.isError}
            />
          </div>
        </div>

        <section className="manual-order-lower-pane-scroll min-h-0 overflow-auto rounded border border-white/10 bg-slate-900/40 p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-amber-200">生産スケジュール（既存UI）</p>
            {lowerPaneStatusMessage ? (
              <span className="text-xs text-amber-200">{lowerPaneStatusMessage}</span>
            ) : null}
          </div>

          <ProductionScheduleToolbar
            inputQuery={inputQuery}
            onInputChange={(value) => setSearchConditions({ inputQuery: value })}
            onOpenKeyboard={openKeyboard}
            onSearch={() => applySearch(inputQuery)}
            onClear={clearAllFilters}
            completedCount={completedCount}
            incompleteCount={incompleteCount}
            hasNoteOnly={hasNoteOnlyFilter}
            onToggleHasNoteOnly={() =>
              setSearchConditions((prev) => ({ hasNoteOnlyFilter: !prev.hasNoteOnlyFilter }))
            }
            hasDueDateOnly={hasDueDateOnlyFilter}
            onToggleHasDueDateOnly={() =>
              setSearchConditions((prev) => ({ hasDueDateOnlyFilter: !prev.hasDueDateOnlyFilter }))
            }
            showGrindingResources={showGrindingResources}
            onToggleGrindingResources={toggleGrindingResources}
            showCuttingResources={showCuttingResources}
            onToggleCuttingResources={toggleCuttingResources}
            selectedMachineName={selectedMachineName}
            machineNameOptions={machineNameOptions}
            onMachineNameChange={handleMachineNameChange}
            selectedPartName={selectedPartName}
            partNameOptions={partNameOptions}
            onPartNameChange={handlePartNameChange}
            onOpenOrderSearch={orderSearch.open}
            isOrderSearchEnabled={isOrderSearchEnabled}
            sortMode={sortMode}
            onSortModeChange={setSortMode}
            canUseManualSort={manualSortEnabled}
            disabled={scheduleQuery.isFetching || completePending}
            isFetching={scheduleQuery.isFetching}
            showFetching={hasQuery}
          />

          <div className="mt-2">
            <ProductionScheduleResourceFilters
              resourceCds={prioritizedVisibleResourceCds}
              normalizedResourceCds={normalizedResourceCds}
              normalizedAssignedOnlyCds={normalizedAssignedOnlyCds}
              getColorClasses={getResourceColorClasses}
              onToggleResourceCd={toggleResourceCd}
              onToggleAssignedOnlyCd={toggleAssignedOnlyCd}
              getResourceAriaLabel={getResourceAriaLabel}
              rightActions={
                <>
                  <ProductionScheduleSeibanFilterDropdown
                    items={seibanFilterItems}
                    selectedCount={selectedSeibanCount}
                    totalCount={seibanFilterItems.length}
                    onToggle={toggleHistoryQuery}
                    onSetAll={setAllHistoryQueries}
                  />
                  <ProductionScheduleResourceFilterDropdown
                    items={resourceFilterItems}
                    selectedCount={selectedResourceCount}
                    assignedOnlySelectedCount={selectedAssignedOnlyCount}
                    onToggleResource={toggleResourceCd}
                    onToggleAssignedOnly={toggleAssignedOnlyCd}
                    onSetAllResource={setAllResourceCds}
                    onSetAllAssignedOnly={setAllAssignedOnlyCds}
                  />
                </>
              }
            />
          </div>

          {sortMode === 'manual' && !manualSortEnabled ? (
            <p className="mt-2 text-xs font-semibold text-amber-300">
              手動順番は単一の資源CDで表示しているときのみ有効です。
            </p>
          ) : null}
          {sortMode === 'auto' && isDisplayRankContext ? (
            <p className="mt-2 text-xs font-semibold text-white/70">
              全体順位は表示対象内の表示順位として 1 から再採番しています（保存値は変更しません）。
            </p>
          ) : null}

          {!canShowSchedule ? (
            <p className="mt-3 text-sm font-semibold text-white/80">上ペインで端末を選択してください。</p>
          ) : !hasQuery ? (
            <p className="mt-3 text-sm font-semibold text-white/80">検索してください。</p>
          ) : scheduleQuery.isLoading ? (
            <p className="mt-3 text-sm font-semibold text-white/80">読み込み中...</p>
          ) : scheduleQuery.isError ? (
            <p className="mt-3 text-sm font-semibold text-rose-300">取得に失敗しました。</p>
          ) : displayRows.length === 0 ? (
            <p className="mt-3 text-sm font-semibold text-white/80">該当するデータはありません。</p>
          ) : (
            <div className="mt-2">
              <ProductionScheduleTable
                tableColumns={tableColumns}
                rowPairs={rowPairs}
                isTwoColumn={isTwoColumn}
                itemSeparatorWidth={itemSeparatorWidth}
                checkWidth={checkWidth}
                itemColumnWidths={itemColumnWidths}
                dueDateColumnWidth={DUE_DATE_COLUMN_WIDTH}
                noteColumnWidth={NOTE_COLUMN_WIDTH}
                completePending={completePending}
                orderPending={orderPending}
                processingPending={processingPending}
                notePending={notePending}
                dueDatePending={dueDatePending}
                canEditProcessingOrder={sortMode === 'manual' && manualSortEnabled}
                processingTypeOptions={processingTypeOptionsQuery.data ?? []}
                getAvailableOrders={getAvailableOrders}
                handleComplete={(rowId) => void completeRow(rowId)}
                handleOrderChange={handleOrderChange}
                handleProcessingChange={handleProcessingChange}
                openDueDatePicker={openDueDatePicker}
                startNoteEdit={startNoteEdit}
                formatDueDate={formatDueDate}
                PencilIcon={PencilIcon}
                CalendarIcon={CalendarIcon}
              />
            </div>
          )}
        </section>
      </div>

      <KioskDatePickerModal
        isOpen={isDueDatePickerOpen}
        value={editingDueDateValue}
        onCancel={closeDueDatePicker}
        onCommit={commitDueDate}
      />
      <KioskNoteModal
        isOpen={isNoteModalOpen}
        value={editingNoteValue}
        maxLength={NOTE_MAX_LENGTH}
        onCancel={closeNoteModal}
        onCommit={commitNote}
      />
      <KioskKeyboardModal
        isOpen={isKeyboardOpen}
        value={keyboardValue}
        onChange={setKeyboardValue}
        onCancel={() => setIsKeyboardOpen(false)}
        onConfirm={confirmKeyboard}
      />
      <ProductionOrderSearchModal
        isOpen={orderSearch.isOpen}
        productNoInput={orderSearch.productNoInput}
        onInputChange={orderSearch.setProductNoInput}
        onClose={orderSearch.close}
        onAppendDigit={orderSearch.appendDigit}
        onBackspace={orderSearch.backspace}
        onClear={orderSearch.clear}
        selectedPartName={orderSearch.selectedPartName}
        partNameOptions={orderSearch.partNameOptions}
        onPartNameChange={orderSearch.setSelectedPartName}
        orders={orderSearch.orders}
        selectedOrderNumbers={orderSearch.selectedOrderNumbers}
        onToggleOrder={orderSearch.toggleOrderNumber}
        onConfirm={orderSearch.confirm}
        canConfirm={orderSearch.canConfirm}
        canSelectPart={orderSearch.canFetchCandidates}
        isLoading={orderSearch.isLoading}
      />
    </div>
  );
}
