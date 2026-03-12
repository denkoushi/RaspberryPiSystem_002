import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useCompleteKioskProductionScheduleRow,
  useKioskProductionSchedule,
  useKioskProductionScheduleOrderUsage,
  useKioskProductionScheduleResources,
  useKioskProductionScheduleHistoryProgress,
  useKioskProductionScheduleProcessingTypeOptions,
  useKioskProductionScheduleSearchState,
  useUpdateKioskProductionScheduleOrder,
  useUpdateKioskProductionScheduleNote,
  useUpdateKioskProductionScheduleDueDate,
  useUpdateKioskProductionScheduleProcessing,
  useUpdateKioskProductionScheduleSearchState
} from '../../api/hooks';
import { KioskDatePickerModal } from '../../components/kiosk/KioskDatePickerModal';
import { KioskKeyboardModal } from '../../components/kiosk/KioskKeyboardModal';
import { KioskNoteModal } from '../../components/kiosk/KioskNoteModal';
import { ProductionScheduleHistoryStrip } from '../../components/kiosk/ProductionScheduleHistoryStrip';
import { ProductionScheduleResourceFilters } from '../../components/kiosk/ProductionScheduleResourceFilters';
import { ProductionScheduleTable } from '../../components/kiosk/ProductionScheduleTable';
import { ProductionScheduleToolbar } from '../../components/kiosk/ProductionScheduleToolbar';
import { type TableColumnDefinition } from '../../features/kiosk/columnWidth';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';
import { moveHistoryItemLeft, moveHistoryItemRight } from '../../features/kiosk/productionSchedule/historyOrder';
import { filterResourceCdsByCategory, isGrindingResourceCd } from '../../features/kiosk/productionSchedule/resourceCategory';
import { getResourceColorClasses, ORDER_NUMBERS } from '../../features/kiosk/productionSchedule/resourceColors';
import { prioritizeResourceCdsByPresence } from '../../features/kiosk/productionSchedule/resourcePriority';
import { useProductionScheduleDerivedRows } from '../../features/kiosk/productionSchedule/useProductionScheduleDerivedRows';
import {
  normalizeHistoryList,
  useProductionScheduleQueryParams
} from '../../features/kiosk/productionSchedule/useProductionScheduleQueryParams';
import { useProductionScheduleSearchConditions } from '../../features/kiosk/productionSchedule/useProductionScheduleSearchConditions';
import { useSharedSearchHistory } from '../../features/kiosk/productionSchedule/useSharedSearchHistory';
import { useLocalStorage } from '../../hooks/useLocalStorage';

const NOTE_MAX_LENGTH = 100;

const SEARCH_HISTORY_KEY = 'production-schedule-search-history';
const SEARCH_HISTORY_HIDDEN_KEY = 'production-schedule-search-history-hidden';
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
    showCuttingResources
  } = searchConditions;
  const [history, setHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_KEY, []);
  const [, setHiddenHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_HIDDEN_KEY, []);
  const [editingNoteRowId, setEditingNoteRowId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState('');
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingDueDateRowId, setEditingDueDateRowId] = useState<string | null>(null);
  const [editingDueDateValue, setEditingDueDateValue] = useState('');
  const [isDueDatePickerOpen, setIsDueDatePickerOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(1200);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [keyboardValue, setKeyboardValue] = useState('');
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
    history
  });
  const completeMutation = useCompleteKioskProductionScheduleRow();
  const orderMutation = useUpdateKioskProductionScheduleOrder();
  const processingMutation = useUpdateKioskProductionScheduleProcessing();
  const noteMutation = useUpdateKioskProductionScheduleNote();
  const dueDateMutation = useUpdateKioskProductionScheduleDueDate();
  const searchStateMutation = useUpdateKioskProductionScheduleSearchState();
  const isWriting =
    completeMutation.isPending ||
    orderMutation.isPending ||
    processingMutation.isPending ||
    noteMutation.isPending ||
    dueDateMutation.isPending ||
    searchStateMutation.isPending;

  // NOTE: 人間の連続操作中に「書き込み完了→即ポーリング復帰→次のクリック」と衝突しやすいため、
  //       書き込み完了後に短いクールダウンを入れて衝突確率を下げる。
  const WRITE_REFETCH_COOLDOWN_MS = 2500;
  const [isWriteCooldown, setIsWriteCooldown] = useState(false);
  const prevIsWritingRef = useRef(false);
  const cooldownTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const prevIsWriting = prevIsWritingRef.current;
    prevIsWritingRef.current = isWriting;

    if (isWriting) {
      // 書き込み中は常に pause。クールダウンタイマーが残っていたら止める。
      if (cooldownTimerRef.current) {
        window.clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      setIsWriteCooldown(false);
      return;
    }

    // 書き込みが「終わった瞬間」にだけクールダウン開始
    if (prevIsWriting && !isWriting) {
      setIsWriteCooldown(true);
      if (cooldownTimerRef.current) {
        window.clearTimeout(cooldownTimerRef.current);
      }
      cooldownTimerRef.current = window.setTimeout(() => {
        cooldownTimerRef.current = null;
        setIsWriteCooldown(false);
      }, WRITE_REFETCH_COOLDOWN_MS);
    }
  }, [isWriting]);

  const pauseRefetch = isWriting || isWriteCooldown;

  const scheduleQuery = useKioskProductionSchedule(queryParams, { enabled: hasQuery, pauseRefetch });
  const resourcesQuery = useKioskProductionScheduleResources({ pauseRefetch });
  const processingTypeOptionsQuery = useKioskProductionScheduleProcessingTypeOptions({ pauseRefetch });
  const searchStateQuery = useKioskProductionScheduleSearchState({ pauseRefetch });
  const historyProgressQuery = useKioskProductionScheduleHistoryProgress({ pauseRefetch });
  const progressBySeiban = historyProgressQuery.data?.progressBySeiban ?? {};

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
    isDisplayRankContext,
    isTwoColumn,
    itemSeparatorWidth,
    checkWidth,
    itemColumnWidths,
    rowPairs
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
    containerWidth
  });

  const orderUsageQuery = useKioskProductionScheduleOrderUsage(
    resourceCdsInRows.length > 0 ? resourceCdsInRows.join(',') : undefined,
    { pauseRefetch }
  );
  const resourceNameMap = useMemo(
    () => resourcesQuery.data?.resourceNameMap ?? {},
    [resourcesQuery.data?.resourceNameMap]
  );
  const getResourceTooltip = useCallback(
    (resourceCd: string) => {
      const names = resourceNameMap[resourceCd] ?? [];
      return names.length > 0 ? names.join('\n') : undefined;
    },
    [resourceNameMap]
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
    return filterResourceCdsByCategory(resourcesQuery.data?.resources ?? [], {
      showGrinding: showGrindingResources,
      showCutting: showCuttingResources
    });
  }, [resourcesQuery.data?.resources, showCuttingResources, showGrindingResources]);

  const prioritizedVisibleResourceCds = useMemo(
    () =>
      prioritizeResourceCdsByPresence(
        visibleResourceCds,
        resourceCdsInRows,
        normalizedActiveQueries.length > 0
      ),
    [visibleResourceCds, resourceCdsInRows, normalizedActiveQueries.length]
  );

  const { updateSharedSearchState } = useSharedSearchHistory({
    normalizedHistory,
    setHistory,
    setHiddenHistory,
    searchStateQuery,
    searchStateMutation
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
  };

  const startNoteEdit = (rowId: string, currentNote: string | null) => {
    setEditingNoteRowId(rowId);
    setEditingNoteValue(currentNote ?? '');
    setIsNoteModalOpen(true);
  };

  const normalizeDueDateInput = (value: string | null) => {
    if (!value) return '';
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : '';
  };

  const openDueDatePicker = (rowId: string, currentDueDate: string | null) => {
    setEditingDueDateRowId(rowId);
    setEditingDueDateValue(normalizeDueDateInput(currentDueDate));
    setIsDueDatePickerOpen(true);
  };

  const closeDueDatePicker = () => {
    setIsDueDatePickerOpen(false);
    setEditingDueDateRowId(null);
    setEditingDueDateValue('');
  };

  const commitDueDate = (nextValue: string) => {
    if (!editingDueDateRowId || dueDateMutation.isPending) return;
    setEditingDueDateValue(nextValue);
    dueDateMutation.mutate(
      { rowId: editingDueDateRowId, dueDate: nextValue },
      {
        onSettled: () => {
          closeDueDatePicker();
        }
      }
    );
  };

  const saveNote = (rowId: string, nextValue?: string) => {
    const valueSource = typeof nextValue === 'string' ? nextValue : editingNoteValue;
    const value = valueSource.replace(/\r?\n/g, '').trim().slice(0, NOTE_MAX_LENGTH);
    if (noteMutation.isPending) return;
    noteMutation.mutate(
      { rowId, note: value },
      {
        onSettled: () => {
          setEditingNoteRowId(null);
          setEditingNoteValue('');
          setIsNoteModalOpen(false);
        }
      }
    );
  };

  const cancelNoteEdit = () => {
    setEditingNoteRowId(null);
    setEditingNoteValue('');
    setIsNoteModalOpen(false);
  };

  const commitNote = (nextValue: string) => {
    if (!editingNoteRowId) return;
    setEditingNoteValue(nextValue);
    saveNote(editingNoteRowId, nextValue);
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

  const removeHistoryQuery = (value: string) => {
    setSearchConditions((prev) => ({ activeQueries: prev.activeQueries.filter((item) => item !== value) }));
    // NOTE: ユーザー要望により「登録製番リスト＝サイネージ表示」と同期する（削除も共有）
    // そのため削除は端末ローカル非表示（hiddenHistory）ではなく shared history を更新する。
    const nextHistory = normalizedHistory.filter((item) => item !== value);
    setHistory(nextHistory);
    setHiddenHistory((prev) => prev.filter((item) => item !== value));
    if (inputQuery === value) {
      setSearchConditions({ inputQuery: '' });
    }
    void updateSharedSearchState(nextHistory, { type: 'remove', value });

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:remove-history',message:'history item removed (shared)',data:{removed:value},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H-delete-not-propagating'})}).catch(()=>{});
    // #endregion agent log
  };

  const confirmRemoveHistoryQuery = (value: string) => {
    const message = `検索履歴「${value}」を削除しますか？`;
    if (!window.confirm(message)) {
      return;
    }
    removeHistoryQuery(value);
  };

  const handleMoveHistoryLeft = (value: string) => {
    const nextHistory = moveHistoryItemLeft(normalizedHistory, value);
    if (nextHistory === normalizedHistory) return;
    setHistory(nextHistory);
    void updateSharedSearchState(nextHistory, { type: 'reorder', value, direction: 'left' });
  };

  const handleMoveHistoryRight = (value: string) => {
    const nextHistory = moveHistoryItemRight(normalizedHistory, value);
    if (nextHistory === normalizedHistory) return;
    setHistory(nextHistory);
    void updateSharedSearchState(nextHistory, { type: 'reorder', value, direction: 'right' });
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

  const toggleGrindingResources = () => {
    setSearchConditions((prev) => ({ showGrindingResources: !prev.showGrindingResources }));
  };

  const toggleCuttingResources = () => {
    setSearchConditions((prev) => ({ showCuttingResources: !prev.showCuttingResources }));
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

  const getAvailableOrders = (resourceCd: string, current: number | null) => {
    const usage = orderUsageQuery.data?.[resourceCd] ?? [];
    return ORDER_NUMBERS.filter((num) => num === current || !usage.includes(num));
  };

  const handleOrderChange = (rowId: string, resourceCd: string, nextValue: string) => {
    const orderNumber = nextValue.length > 0 ? Number(nextValue) : null;
    orderMutation.mutate({ rowId, payload: { resourceCd, orderNumber } });
  };

  const handleProcessingChange = (rowId: string, nextValue: string) => {
    processingMutation.mutate({ rowId, processingType: nextValue });
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
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'30be23'},body:JSON.stringify({sessionId:'30be23',runId:'kiosk-wait-debug',hypothesisId:'H3',location:'apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:handleComplete:start',message:'complete click',data:{rowId,pauseRefetch,isWriting,isWriteCooldown,isFetchingSchedule,fetchingCountSchedule,fetchingCountOrderUsage,completePending:completeMutation.isPending},timestamp:Date.now()})}).catch(()=>{});
      // #endregion agent log
    }

    // Optimistic Updateにより、UIは即座に更新される
    try {
      await completeMutation.mutateAsync(rowId);
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
        disabled={scheduleQuery.isFetching || completeMutation.isPending}
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
        getResourceTooltip={getResourceTooltip}
        getResourceAriaLabel={getResourceAriaLabel}
      />

      <ProductionScheduleHistoryStrip
        visibleHistory={visibleHistory}
        normalizedActiveQueries={normalizedActiveQueries}
        progressBySeiban={progressBySeiban}
        onToggleHistoryQuery={toggleHistoryQuery}
        onConfirmRemoveHistoryQuery={confirmRemoveHistoryQuery}
        onMoveHistoryLeft={handleMoveHistoryLeft}
        onMoveHistoryRight={handleMoveHistoryRight}
      />

      {isDisplayRankContext ? (
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
          completePending={completeMutation.isPending}
          orderPending={orderMutation.isPending}
          processingPending={processingMutation.isPending}
          notePending={noteMutation.isPending}
          dueDatePending={dueDateMutation.isPending}
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
        onCancel={cancelNoteEdit}
        onCommit={commitNote}
      />
      <KioskKeyboardModal
        isOpen={isKeyboardOpen}
        value={keyboardValue}
        onChange={setKeyboardValue}
        onCancel={() => setIsKeyboardOpen(false)}
        onConfirm={confirmKeyboard}
      />
    </div>
  );
}

