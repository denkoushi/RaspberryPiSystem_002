import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useKioskProductionSchedule,
  useKioskProductionScheduleManualOrderSiteDevices,
  useKioskProductionScheduleOrderUsage,
  useKioskProductionScheduleResources,
  useKioskProductionScheduleHistoryProgress,
  useKioskProductionScheduleProcessingTypeOptions,
  useKioskProductionScheduleSearchState,
  useUpdateKioskProductionScheduleSearchState
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { KioskKeyboardModal } from '../../components/kiosk/KioskKeyboardModal';
import { KioskNoteModal } from '../../components/kiosk/KioskNoteModal';
import { ProductionOrderSearchModal } from '../../components/kiosk/ProductionOrderSearchModal';
import { ProductionScheduleResourceFilterDropdown } from '../../components/kiosk/ProductionScheduleResourceFilterDropdown';
import { ProductionScheduleResourceFilters } from '../../components/kiosk/ProductionScheduleResourceFilters';
import { ProductionScheduleSeibanFilterDropdown } from '../../components/kiosk/ProductionScheduleSeibanFilterDropdown';
import { ProductionScheduleTable } from '../../components/kiosk/ProductionScheduleTable';
import { ProductionScheduleToolbar } from '../../components/kiosk/ProductionScheduleToolbar';
import { type TableColumnDefinition } from '../../features/kiosk/columnWidth';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';
import { filterResourceCdsByCategory, isGrindingResourceCd } from '../../features/kiosk/productionSchedule/resourceCategory';
import { getResourceColorClasses, ORDER_NUMBERS } from '../../features/kiosk/productionSchedule/resourceColors';
import { prioritizeResourceCdsByPresence } from '../../features/kiosk/productionSchedule/resourcePriority';
import { useMutationFeedback } from '../../features/kiosk/productionSchedule/useMutationFeedback';
import { useProductionOrderSearch } from '../../features/kiosk/productionSchedule/useProductionOrderSearch';
import { useProductionScheduleDerivedRows } from '../../features/kiosk/productionSchedule/useProductionScheduleDerivedRows';
import { useProductionScheduleMutations } from '../../features/kiosk/productionSchedule/useProductionScheduleMutations';
import {
  normalizeHistoryList,
  useProductionScheduleQueryParams
} from '../../features/kiosk/productionSchedule/useProductionScheduleQueryParams';
import { useProductionScheduleSearchConditions } from '../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions';
import { useSharedSearchHistory } from '../../features/kiosk/productionSchedule/useSharedSearchHistory';
import { useLocalStorage } from '../../hooks/useLocalStorage';
import { isMacEnvironment } from '../../lib/client-key/resolver';

import type { ProductionScheduleSortMode } from '../../features/kiosk/productionSchedule/displayRowDerivation';

const NOTE_MAX_LENGTH = 100;
const MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED =
  import.meta.env.VITE_KIOSK_MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED !== 'false';
const PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY = 'production-schedule-mac-target-site';
const PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY = 'production-schedule-mac-target-device';
const DEFAULT_MAC_TARGET_SITES = ['第2工場', 'トークプラザ', '第1工場'] as const;

const SEARCH_HISTORY_KEY = 'production-schedule-search-history';
const SEARCH_HISTORY_HIDDEN_KEY = 'production-schedule-search-history-hidden';
const SORT_MODE_KEY = 'production-schedule-sort-mode';
const NOTE_COLUMN_WIDTH = 140;
const DUE_DATE_COLUMN_WIDTH = 110;

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


export function ProductionSchedulePage() {
  const queryClient = useQueryClient();
  const isMac =
    typeof window !== 'undefined' ? isMacEnvironment(window.navigator.userAgent) : false;
  const macManualOrderV2 = isMac && MANUAL_ORDER_DEVICE_SCOPE_V2_ENABLED;
  const [macTargetSite, setMacTargetSite] = useState<string>(() => {
    if (typeof window === 'undefined') return DEFAULT_MAC_TARGET_SITES[0];
    const stored = window.localStorage.getItem(PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY)?.trim();
    return stored && stored.length > 0 ? stored : DEFAULT_MAC_TARGET_SITES[0];
  });
  const [macTargetDevice, setMacTargetDevice] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY)?.trim() ?? '';
  });
  const macSiteDevicesQuery = useKioskProductionScheduleManualOrderSiteDevices(
    macManualOrderV2 ? macTargetSite : undefined,
    { enabled: macManualOrderV2 }
  );
  useEffect(() => {
    if (!macManualOrderV2) return;
    const keys = macSiteDevicesQuery.data?.deviceScopeKeys ?? [];
    if (keys.length === 0) return;
    if (!macTargetDevice || !keys.includes(macTargetDevice)) {
      const next = keys[0] ?? '';
      setMacTargetDevice(next);
      if (typeof window !== 'undefined' && next) {
        window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY, next);
      }
    }
  }, [macManualOrderV2, macSiteDevicesQuery.data?.deviceScopeKeys, macTargetDevice]);
  const cursorDebugEnabled = typeof window !== 'undefined' && window.location.search.includes('cursor_debug=30be23');
  const [searchConditions, setSearchConditions, resetSearchConditions] = useProductionScheduleSearchConditions();
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
  const [history, setHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_KEY, []);
  const [, setHiddenHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_HIDDEN_KEY, []);
  const [sortMode, setSortMode] = useLocalStorage<ProductionScheduleSortMode>(SORT_MODE_KEY, 'manual');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardValue, setKeyboardValue] = useState('');
  const [selectedOrderNumbers, setSelectedOrderNumbers] = useState<string[]>([]);
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
      ...(macManualOrderV2 && macTargetDevice.trim().length > 0
        ? { targetDeviceScopeKey: macTargetDevice.trim() }
        : {})
    }),
    [macManualOrderV2, macTargetDevice, queryParams]
  );
  const macScheduleQueryEnabled =
    hasQuery && (!macManualOrderV2 || macTargetDevice.trim().length > 0);
  const searchStateMutation = useUpdateKioskProductionScheduleSearchState();
  const {
    completePending,
    orderPending,
    processingPending,
    notePending,
    dueDatePending,
    isWriting,
    isWriteCooldown,
    pauseRefetch,
    updateOrder,
    updateProcessing,
    saveNote,
    commitDueDate: commitDueDateMutation,
    completeRow
  } = useProductionScheduleMutations({
    isSearchStateWriting: searchStateMutation.isPending,
    noteMaxLength: NOTE_MAX_LENGTH,
    productionScheduleTargetDeviceScopeKey:
      macManualOrderV2 && macTargetDevice.trim().length > 0 ? macTargetDevice.trim() : undefined
  });

  const scheduleQuery = useKioskProductionSchedule(scheduleListParams, {
    enabled: macScheduleQueryEnabled,
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

  // Debug: 「10往復目くらいでたまに数秒待つ」が、(a) 完了API遅延なのか (b) 再取得競合なのかを分離する
  const scheduleFetchStartRef = useRef<number | null>(null);
  const prevScheduleFetchingRef = useRef<boolean>(false);
  useEffect(() => {
    const prev = prevScheduleFetchingRef.current;
    const next = scheduleQuery.isFetching;
    prevScheduleFetchingRef.current = next;
    if (!hasQuery) return;

    if (!prev && next) {
      scheduleFetchStartRef.current = performance.now();
      if (cursorDebugEnabled) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30be23'},body:JSON.stringify({sessionId:'30be23',runId:'kiosk-wait-debug',hypothesisId:'H2',location:'apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:schedule-fetch-start',message:'scheduleQuery fetch started',data:{pauseRefetch,isWriting,isWriteCooldown,isLoading:scheduleQuery.isLoading,fetchingCountSchedule:queryClient.isFetching({queryKey:['kiosk-production-schedule']}),fetchingCountOrderUsage:queryClient.isFetching({queryKey:['kiosk-production-schedule-order-usage']}),hasQuery},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log
      }
      return;
    }

    if (prev && !next) {
      const start = scheduleFetchStartRef.current;
      const elapsedMs = start ? Math.round(performance.now() - start) : null;
      scheduleFetchStartRef.current = null;
      if (cursorDebugEnabled) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30be23'},body:JSON.stringify({sessionId:'30be23',runId:'kiosk-wait-debug',hypothesisId:'H2',location:'apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:schedule-fetch-end',message:'scheduleQuery fetch ended',data:{elapsedMs,pauseRefetch,isWriting,isWriteCooldown,isError:scheduleQuery.isError},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log
      }
    }
  }, [
    cursorDebugEnabled,
    hasQuery,
    isWriteCooldown,
    isWriting,
    pauseRefetch,
    queryClient,
    scheduleQuery.isError,
    scheduleQuery.isFetching,
    scheduleQuery.isLoading
  ]);

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

  const machineNameOptionsFromHistory = useMemo(() => {
    const unique = new Map<string, string>();
    Object.values(progressBySeiban).forEach((item) => {
      const machineName = String(item.machineName ?? '').trim();
      if (machineName.length === 0) return;
      const key = machineName.toUpperCase();
      if (!unique.has(key)) {
        unique.set(key, machineName);
      }
    });
    return Array.from(unique.values()).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [progressBySeiban]);

  const mergedMachineNameOptions = useMemo(() => {
    const unique = new Map<string, string>();
    [...machineNameOptionsFromHistory, ...machineNameOptions].forEach((machineName) => {
      const trimmed = machineName.trim();
      if (trimmed.length === 0) return;
      const key = trimmed.toUpperCase();
      if (!unique.has(key)) {
        unique.set(key, trimmed);
      }
    });
    return Array.from(unique.values()).sort((a, b) => a.localeCompare(b, 'ja'));
  }, [machineNameOptions, machineNameOptionsFromHistory]);

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
      enabled: !macManualOrderV2 || macTargetDevice.trim().length > 0,
      ...(macManualOrderV2 && macTargetDevice.trim().length > 0
        ? { targetDeviceScopeKey: macTargetDevice.trim() }
        : {})
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
    return filterResourceCdsByCategory(resourcesQuery.data?.resources ?? [], {
      showGrinding: showGrindingResources,
      showCutting: showCuttingResources
    }, {
      cuttingExcludedResourceCds
    });
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
    setSearchConditions({
      activeQueries: selected ? visibleHistory : []
    });
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
    setSearchConditions({
      activeResourceCds: selected ? prioritizedVisibleResourceCds : []
    });
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
    if (!selectedResourceCategory) {
      return;
    }
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

  const handleComplete = async (rowId: string) => {
    const t0 = performance.now();
    const isFetchingSchedule = scheduleQuery.isFetching;
    const fetchingCountSchedule = queryClient.isFetching({ queryKey: ['kiosk-production-schedule'] });
    const fetchingCountOrderUsage = queryClient.isFetching({ queryKey: ['kiosk-production-schedule-order-usage'] });
    if (cursorDebugEnabled) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30be23'},body:JSON.stringify({sessionId:'30be23',runId:'kiosk-wait-debug',hypothesisId:'H3',location:'apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:handleComplete:start',message:'complete click',data:{rowId,pauseRefetch,isWriting,isWriteCooldown,isFetchingSchedule,fetchingCountSchedule,fetchingCountOrderUsage,completePending},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log
    }

    // Optimistic Updateにより、UIは即座に更新される
    try {
      await completeRow(rowId);
      const elapsedMs = Math.round(performance.now() - t0);
      if (cursorDebugEnabled) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30be23'},body:JSON.stringify({sessionId:'30be23',runId:'kiosk-wait-debug',hypothesisId:'H1',location:'apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:handleComplete:success',message:'complete mutation resolved',data:{rowId,elapsedMs},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log
      }
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - t0);
      if (cursorDebugEnabled) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30be23'},body:JSON.stringify({sessionId:'30be23',runId:'kiosk-wait-debug',hypothesisId:'H1',location:'apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:handleComplete:error',message:'complete mutation rejected',data:{rowId,elapsedMs,isAxiosError:isAxiosError(error),status:isAxiosError(error)?(error.response?.status??null):null},timestamp:Date.now()})}).catch(()=>{});
        // #endregion agent log
      }
      throw error;
    }
  };

  return (
    <div className="flex h-full flex-col gap-2" ref={containerRef}>
      {macManualOrderV2 ? (
        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-50">
          <span className="font-semibold text-amber-100">Mac: 表示・更新先端末</span>
          <select
            value={macTargetSite}
            onChange={(event) => {
              const next = event.target.value;
              setMacTargetSite(next);
              setMacTargetDevice('');
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_SITE_KEY, next);
                window.localStorage.removeItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY);
              }
            }}
            className="h-8 max-w-[200px] rounded border border-amber-300/50 bg-slate-900 px-2 text-xs text-white"
            aria-label="工場を選択"
          >
            {DEFAULT_MAC_TARGET_SITES.map((site) => (
              <option key={site} value={site}>
                {site}
              </option>
            ))}
          </select>
          <select
            value={macTargetDevice}
            onChange={(event) => {
              const next = event.target.value;
              setMacTargetDevice(next);
              if (typeof window !== 'undefined' && next) {
                window.localStorage.setItem(PRODUCTION_SCHEDULE_MAC_TARGET_DEVICE_KEY, next);
              }
            }}
            disabled={macSiteDevicesQuery.isLoading || (macSiteDevicesQuery.data?.deviceScopeKeys.length ?? 0) === 0}
            className="h-8 max-w-[min(100%,360px)] flex-1 rounded border border-amber-300/50 bg-slate-900 px-2 text-xs text-white disabled:opacity-50"
            aria-label="端末 deviceScopeKey を選択"
          >
            {(macSiteDevicesQuery.data?.deviceScopeKeys ?? []).length === 0 ? (
              <option value="">登録端末を読み込み中…</option>
            ) : null}
            {(macSiteDevicesQuery.data?.deviceScopeKeys ?? []).map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          {macManualOrderV2 && macTargetDevice.trim().length === 0 ? (
            <span className="text-rose-200">
              端末を選択してください（未指定の場合、一覧取得は 400 になります）
            </span>
          ) : null}
        </div>
      ) : null}

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
        machineNameOptions={mergedMachineNameOptions}
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

      {sortMode === 'manual' && !manualSortEnabled ? (
        <p className="text-xs font-semibold text-amber-300">
          手動順番は単一の資源CDで表示しているときのみ有効です。
        </p>
      ) : null}
      {sortMode === 'auto' && isDisplayRankContext ? (
        <p className="text-xs font-semibold text-white/70">
          全体順位は表示対象内の表示順位として 1 から再採番しています（保存値は変更しません）。
        </p>
      ) : null}

      {!hasQuery ? (
        <p className="text-sm font-semibold text-white/80">検索してください。</p>
      ) : scheduleQuery.isLoading ? (
        <p className="text-sm font-semibold text-white/80">読み込み中...</p>
      ) : scheduleQuery.isError ? (
        <p className="text-sm font-semibold text-rose-300">取得に失敗しました。</p>
      ) : displayRows.length === 0 ? (
        <p className="text-sm font-semibold text-white/80">該当するデータはありません。</p>
      ) : (
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
          handleComplete={handleComplete}
          handleOrderChange={handleOrderChange}
          handleProcessingChange={handleProcessingChange}
          openDueDatePicker={openDueDatePicker}
          startNoteEdit={startNoteEdit}
          formatDueDate={formatDueDate}
          PencilIcon={PencilIcon}
          CalendarIcon={CalendarIcon}
        />
      )}
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

