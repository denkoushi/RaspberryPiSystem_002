import { isAxiosError } from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useCompleteKioskProductionScheduleRow,
  useKioskProductionSchedule,
  useKioskProductionScheduleOrderUsage,
  useKioskProductionScheduleResources,
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
import { ProductionScheduleToolbar } from '../../components/kiosk/ProductionScheduleToolbar';
import { PillButton } from '../../components/layout/PillButton';
import { computeColumnWidths, type TableColumnDefinition } from '../../features/kiosk/columnWidth';
import { formatDueDate } from '../../features/kiosk/productionSchedule/formatDueDate';
import { getResourceColorClasses, ORDER_NUMBERS } from '../../features/kiosk/productionSchedule/resourceColors';
import { useLocalStorage } from '../../hooks/useLocalStorage';

type ScheduleRowData = {
  ProductNo?: string;
  FSEIBAN?: string;
  FHINCD?: string;
  FHINMEI?: string;
  FSIGENCD?: string;
  FSIGENSHOYORYO?: string | number;
  FKOJUN?: string | number;
  progress?: string;
};

const NOTE_MAX_LENGTH = 100;
const PROCESSING_TYPES = ['塗装', 'カニゼン', 'LSLH', 'その他01', 'その他02'] as const;

type NormalizedScheduleRow = {
  id: string;
  isCompleted: boolean;
  data: ScheduleRowData;
  values: Record<string, string>;
  processingOrder: number | null;
  processingType: string | null;
  note: string | null;
  dueDate: string | null;
};

const SEARCH_HISTORY_KEY = 'production-schedule-search-history';
const SEARCH_HISTORY_HIDDEN_KEY = 'production-schedule-search-history-hidden';
const NOTE_COLUMN_WIDTH = 140;
const DUE_DATE_COLUMN_WIDTH = 110;

const isSameHistory = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const normalizeHistoryList = (items: string[]) => {
  const unique = new Set<string>();
  const next: string[] = [];
  items
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .forEach((item) => {
      if (unique.has(item)) return;
      unique.add(item);
      next.push(item);
    });
  return next.slice(0, 8);
};

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
  const [inputQuery, setInputQuery] = useState('');
  const [activeQueries, setActiveQueries] = useState<string[]>([]);
  const [history, setHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_KEY, []);
  const [, setHiddenHistory] = useLocalStorage<string[]>(SEARCH_HISTORY_HIDDEN_KEY, []);
  const [activeResourceCds, setActiveResourceCds] = useState<string[]>([]);
  const [activeResourceAssignedOnlyCds, setActiveResourceAssignedOnlyCds] = useState<string[]>([]);
  const [hasNoteOnlyFilter, setHasNoteOnlyFilter] = useState(false);
  const [hasDueDateOnlyFilter, setHasDueDateOnlyFilter] = useState(false);
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
  const searchStateUpdatedAtRef = useRef<string | null>(null);
  const searchStateEtagRef = useRef<string | null>(null);

  const normalizedActiveQueries = useMemo(() => {
    const unique = new Set<string>();
    activeQueries
      .map((query) => query.trim())
      .filter((query) => query.length > 0)
      .forEach((query) => unique.add(query));
    return Array.from(unique);
  }, [activeQueries]);

  const normalizedHistory = useMemo(() => normalizeHistoryList(history), [history]);
  // NOTE: ユーザー要望により「登録製番リスト＝サイネージ表示」と同期する（削除も共有）
  // そのため hiddenHistory（端末ローカル非表示）よりも shared history を優先し、表示はsharedをそのまま使う。
  const visibleHistory = normalizedHistory;

  const normalizedResourceCds = useMemo(() => {
    const unique = new Set<string>();
    activeResourceCds
      .map((cd) => cd.trim())
      .filter((cd) => cd.length > 0)
      .forEach((cd) => unique.add(cd));
    return Array.from(unique);
  }, [activeResourceCds]);

  const normalizedAssignedOnlyCds = useMemo(() => {
    const unique = new Set<string>();
    activeResourceAssignedOnlyCds
      .map((cd) => cd.trim())
      .filter((cd) => cd.length > 0)
      .forEach((cd) => unique.add(cd));
    return Array.from(unique);
  }, [activeResourceAssignedOnlyCds]);

  const queryParams = useMemo(
    () => ({
      q: normalizedActiveQueries.length > 0 ? normalizedActiveQueries.join(',') : undefined,
      resourceCds: normalizedResourceCds.length > 0 ? normalizedResourceCds.join(',') : undefined,
      resourceAssignedOnlyCds: normalizedAssignedOnlyCds.length > 0 ? normalizedAssignedOnlyCds.join(',') : undefined,
      hasNoteOnly: hasNoteOnlyFilter || undefined,
      hasDueDateOnly: hasDueDateOnlyFilter || undefined,
      page: 1,
      pageSize: 400
    }),
    [normalizedActiveQueries, normalizedAssignedOnlyCds, normalizedResourceCds, hasNoteOnlyFilter, hasDueDateOnlyFilter]
  );
  // 資源CD単独では検索しない（登録製番単独・AND検索は維持）。備考ありのみは単独で有効
  const hasQuery =
    normalizedActiveQueries.length > 0 ||
    normalizedAssignedOnlyCds.length > 0 ||
    hasNoteOnlyFilter ||
    hasDueDateOnlyFilter;
  const scheduleQuery = useKioskProductionSchedule(queryParams, { enabled: hasQuery });
  const completeMutation = useCompleteKioskProductionScheduleRow();
  const orderMutation = useUpdateKioskProductionScheduleOrder();
  const processingMutation = useUpdateKioskProductionScheduleProcessing();
  const noteMutation = useUpdateKioskProductionScheduleNote();
  const dueDateMutation = useUpdateKioskProductionScheduleDueDate();
  const resourcesQuery = useKioskProductionScheduleResources();
  const searchStateQuery = useKioskProductionScheduleSearchState();
  const searchStateMutation = useUpdateKioskProductionScheduleSearchState();

  const tableColumns: TableColumnDefinition[] = useMemo(
    () => [
      { key: 'FHINCD', label: '品番' },
      { key: 'ProductNo', label: '製造order番号' },
      { key: 'FHINMEI', label: '品名' },
      { key: 'FSIGENCD', label: '資源CD' },
      { key: 'processingOrder', label: '順番', dataType: 'number' },
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

  const normalizedRows = useMemo<NormalizedScheduleRow[]>(() => {
    const sourceRows = scheduleQuery.data?.rows ?? [];
    return sourceRows.map((r) => {
      const d = (r.rowData ?? {}) as ScheduleRowData;
      const processingOrder = typeof r.processingOrder === 'number' ? r.processingOrder : null;
      const processingType = typeof r.processingType === 'string' && r.processingType.trim().length > 0 ? r.processingType : null;
      const note = typeof r.note === 'string' && r.note.trim().length > 0 ? r.note.trim() : null;
      const dueDate = typeof r.dueDate === 'string' && r.dueDate.trim().length > 0 ? r.dueDate.trim() : null;
      const values = {
        FHINCD: String(d.FHINCD ?? ''),
        ProductNo: String(d.ProductNo ?? ''),
        FHINMEI: String(d.FHINMEI ?? ''),
        FSIGENCD: String(d.FSIGENCD ?? ''),
        processingOrder: processingOrder ? String(processingOrder) : '',
        processingType: processingType ?? '',
        FSIGENSHOYORYO: String(d.FSIGENSHOYORYO ?? ''),
        FKOJUN: String(d.FKOJUN ?? ''),
        FSEIBAN: String(d.FSEIBAN ?? '')
      };
      return {
        id: r.id,
        isCompleted: d.progress === '完了',
        data: d,
        values,
        processingOrder,
        processingType,
        note,
        dueDate
      };
    });
  }, [scheduleQuery.data?.rows]);

  const { completedCount, incompleteCount } = useMemo(() => {
    const completed = normalizedRows.filter((row) => row.isCompleted).length;
    return {
      completedCount: completed,
      incompleteCount: normalizedRows.length - completed
    };
  }, [normalizedRows]);

  const resourceCdsInRows = useMemo(() => {
    const unique = new Set<string>();
    normalizedRows.forEach((row) => {
      if (row.data.FSIGENCD) unique.add(row.data.FSIGENCD);
    });
    return Array.from(unique);
  }, [normalizedRows]);

  const orderUsageQuery = useKioskProductionScheduleOrderUsage(
    resourceCdsInRows.length > 0 ? resourceCdsInRows.join(',') : undefined
  );

  const isTwoColumn = containerWidth >= 1200;
  const itemSeparatorWidth = isTwoColumn ? 24 : 0;
  const checkWidth = 36;
  const itemWidth = isTwoColumn
    ? Math.floor((containerWidth - itemSeparatorWidth) / 2)
    : Math.floor(containerWidth);
  const widthSampleRows = useMemo(
    () => normalizedRows.slice(0, 80).map((row) => row.values),
    [normalizedRows]
  );
  const itemColumnWidths = useMemo(() => {
    return computeColumnWidths({
      columns: tableColumns,
      rows: widthSampleRows,
      containerWidth: Math.max(0, itemWidth - checkWidth),
      fontSizePx: 12,
      scale: 0.5, // 列間パディングを半分に
      fixedWidths: {
        FSEIBAN: 90 // 製番列を固定幅（桁数固定前提で最小限）
      },
      formatCellValue: (column, value) => {
        if (column.key === 'FSEIBAN') {
          return String(value ?? '');
        }
        return String(value ?? '');
      }
    });
  }, [tableColumns, widthSampleRows, itemWidth]);

  const rowPairs = useMemo(() => {
    if (!isTwoColumn) {
      return normalizedRows.map((row) => [row, undefined] as const);
    }
    const pairs: Array<[NormalizedScheduleRow, NormalizedScheduleRow | undefined]> = [];
    for (let i = 0; i < normalizedRows.length; i += 2) {
      pairs.push([normalizedRows[i], normalizedRows[i + 1]]);
    }
    return pairs;
  }, [normalizedRows, isTwoColumn]);

  type SearchStateOperation = { type: 'add' | 'remove'; value: string };

  const updateSharedSearchState = useCallback(
    async (nextHistory: string[], operation: SearchStateOperation, attempt = 0) => {
      if (!searchStateEtagRef.current) {
        await searchStateQuery.refetch();
      }
      const ifMatch = searchStateEtagRef.current;
      if (!ifMatch) {
        return;
      }
      try {
        const result = await searchStateMutation.mutateAsync({
          state: { history: nextHistory },
          ifMatch,
        });
        searchStateUpdatedAtRef.current = result.updatedAt;
        if (result.etag) {
          searchStateEtagRef.current = result.etag;
        }
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 409 && attempt < 2) {
          const details = (error.response?.data?.details ?? {}) as {
            state?: { history?: string[] };
            updatedAt?: string | null;
            etag?: string | null;
          };
          const latestHistory = normalizeHistoryList(details.state?.history ?? []);
          const rebasedHistory =
            operation.type === 'add'
              ? normalizeHistoryList([operation.value, ...latestHistory])
              : latestHistory.filter((item) => item !== operation.value);
          setHistory(rebasedHistory);
          setHiddenHistory((prev) => prev.filter((item) => item !== operation.value));
          if (details.updatedAt) {
            searchStateUpdatedAtRef.current = details.updatedAt;
          }
          if (details.etag) {
            searchStateEtagRef.current = details.etag;
          }
          await updateSharedSearchState(rebasedHistory, operation, attempt + 1);
          return;
        }
        throw error;
      }
    },
    [searchStateMutation, searchStateQuery, setHiddenHistory, setHistory]
  );

  const applySearch = (value: string) => {
    const trimmed = value.trim();
    setInputQuery(trimmed);
    setActiveQueries(trimmed.length > 0 ? [trimmed] : []);
    if (trimmed.length > 0) {
      const nextHistory = normalizeHistoryList([trimmed, ...normalizedHistory]);
      setHistory(nextHistory);
      setHiddenHistory((prev) => prev.filter((item) => item.trim() !== trimmed));
      void updateSharedSearchState(nextHistory, { type: 'add', value: trimmed });
    }
  };

  const clearAllFilters = () => {
    setInputQuery('');
    setActiveQueries([]);
    setActiveResourceCds([]);
    setActiveResourceAssignedOnlyCds([]);
    setHasNoteOnlyFilter(false);
    setHasDueDateOnlyFilter(false);
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
    setActiveQueries((prev) => {
      const exists = prev.includes(value);
      if (exists) {
        return prev.filter((item) => item !== value);
      }
      const next = [...prev, value];
      return next.slice(0, 8);
    });
  };

  const removeHistoryQuery = (value: string) => {
    setActiveQueries((prev) => prev.filter((item) => item !== value));
    // NOTE: ユーザー要望により「登録製番リスト＝サイネージ表示」と同期する（削除も共有）
    // そのため削除は端末ローカル非表示（hiddenHistory）ではなく shared history を更新する。
    const nextHistory = normalizedHistory.filter((item) => item !== value);
    setHistory(nextHistory);
    setHiddenHistory((prev) => prev.filter((item) => item !== value));
    if (inputQuery === value) {
      setInputQuery('');
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

  const toggleResourceCd = (value: string) => {
    setActiveResourceCds((prev) => {
      const exists = prev.includes(value);
      if (exists) {
        return prev.filter((item) => item !== value);
      }
      return [...prev, value];
    });
  };

  const toggleAssignedOnlyCd = (value: string) => {
    setActiveResourceAssignedOnlyCds((prev) => {
      const exists = prev.includes(value);
      if (exists) {
        return prev.filter((item) => item !== value);
      }
      return [...prev, value];
    });
  };

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

  useEffect(() => {
    const updatedAt = searchStateQuery.data?.updatedAt ?? null;
    const incomingState = searchStateQuery.data?.state ?? null;
    const incomingEtag = searchStateQuery.data?.etag ?? null;
    if (incomingEtag) {
      searchStateEtagRef.current = incomingEtag;
    }
    if (!updatedAt || !incomingState) return;

    const lastUpdatedAt = searchStateUpdatedAtRef.current;
    if (lastUpdatedAt && new Date(updatedAt).getTime() <= new Date(lastUpdatedAt).getTime()) {
      return;
    }

    const incomingHistory = normalizeHistoryList(incomingState.history ?? []);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'apps/web/src/pages/kiosk/ProductionSchedulePage.tsx:search-state-sync',message:'search-state received',data:{updatedAt,incomingHistoryCount:incomingHistory.length,localHistoryCount:normalizedHistory.length,isSame:isSameHistory(incomingHistory,normalizedHistory)},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H-stale-overwrite'})}).catch(()=>{});
    // #endregion agent log

    // サーバー側のshared historyを正とし、縮退（削除）も反映する
    if (!isSameHistory(incomingHistory, normalizedHistory)) {
      setHistory(incomingHistory);
      // 端末ローカルの非表示は同期の妨げになるためクリア（残っていてもUIには使わないが誤解を避ける）
      setHiddenHistory([]);
    }
    searchStateUpdatedAtRef.current = updatedAt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    searchStateQuery.data?.state,
    searchStateQuery.data?.updatedAt,
    searchStateQuery.data?.etag,
    normalizedHistory,
    setHistory
  ]);
  const openKeyboard = () => {
    setKeyboardValue(inputQuery);
    setIsKeyboardOpen(true);
  };

  const confirmKeyboard = () => {
    setInputQuery(keyboardValue);
    setIsKeyboardOpen(false);
  };

  const handleComplete = async (rowId: string) => {
    // Optimistic Updateにより、UIは即座に更新される
    await completeMutation.mutateAsync(rowId);
  };

  return (
    <div className="flex h-full flex-col gap-2" ref={containerRef}>

      <ProductionScheduleToolbar
        inputQuery={inputQuery}
        onInputChange={setInputQuery}
        onOpenKeyboard={openKeyboard}
        onSearch={() => applySearch(inputQuery)}
        onClear={clearAllFilters}
        completedCount={completedCount}
        incompleteCount={incompleteCount}
        hasNoteOnly={hasNoteOnlyFilter}
        onToggleHasNoteOnly={() => setHasNoteOnlyFilter((value) => !value)}
        hasDueDateOnly={hasDueDateOnlyFilter}
        onToggleHasDueDateOnly={() => setHasDueDateOnlyFilter((value) => !value)}
        disabled={scheduleQuery.isFetching || completeMutation.isPending}
        isFetching={scheduleQuery.isFetching}
        showFetching={hasQuery}
      />

      <div className="flex w-full items-center gap-2 overflow-x-auto pb-1">
        {(resourcesQuery.data ?? []).map((resourceCd) => {
          const colorClasses = getResourceColorClasses(resourceCd);
          const isActive = normalizedResourceCds.includes(resourceCd);
          const isAssignedActive = normalizedAssignedOnlyCds.includes(resourceCd);
          return (
            <div key={resourceCd} className="flex items-center gap-1 whitespace-nowrap">
              <PillButton
                onClick={() => toggleResourceCd(resourceCd)}
                className={`${colorClasses.border} ${isActive ? colorClasses.bgStrong : colorClasses.bgSoft} ${colorClasses.text}`}
              >
                {resourceCd}
              </PillButton>
              <PillButton
                onClick={() => toggleAssignedOnlyCd(resourceCd)}
                className={`${colorClasses.border} ${
                  isAssignedActive ? colorClasses.bgStrong : colorClasses.bgSoft
                } ${colorClasses.text}`}
              >
                {resourceCd} 割当
              </PillButton>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {visibleHistory.map((h) => {
          const isActive = normalizedActiveQueries.includes(h);
          return (
            <div
              key={h}
              role="button"
              tabIndex={0}
              onClick={() => toggleHistoryQuery(h)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  toggleHistoryQuery(h);
                }
              }}
              className={`relative cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                isActive
                  ? 'border-emerald-300 bg-emerald-400 text-slate-900 hover:bg-emerald-300'
                  : 'border-white/20 bg-white/10 text-white hover:bg-white/20'
              }`}
            >
              {h}
              <button
                type="button"
                aria-label={`履歴から削除: ${h}`}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-slate-900 shadow hover:bg-amber-300"
                onClick={(event) => {
                  event.stopPropagation();
                  confirmRemoveHistoryQuery(h);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      {!hasQuery ? (
        <p className="text-sm font-semibold text-white/80">検索してください。</p>
      ) : scheduleQuery.isLoading ? (
        <p className="text-sm font-semibold text-white/80">読み込み中...</p>
      ) : scheduleQuery.isError ? (
        <p className="text-sm font-semibold text-rose-300">取得に失敗しました。</p>
      ) : normalizedRows.length === 0 ? (
        <p className="text-sm font-semibold text-white/80">該当するデータはありません。</p>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-left text-xs text-white">
            <colgroup>
              <col style={{ width: checkWidth }} />
              {itemColumnWidths.map((width, index) => (
                <col key={`left-${tableColumns[index]?.key ?? index}`} style={{ width }} />
              ))}
            <col style={{ width: DUE_DATE_COLUMN_WIDTH }} />
              <col style={{ width: NOTE_COLUMN_WIDTH }} />
              {isTwoColumn ? <col style={{ width: itemSeparatorWidth }} /> : null}
              {isTwoColumn
                ? [<col key="right-check" style={{ width: checkWidth }} />]
                    .concat(
                      itemColumnWidths.map((width, index) => (
                        <col key={`right-${tableColumns[index]?.key ?? index}`} style={{ width }} />
                      ))
                    )
                  .concat([
                    <col key="right-due-date" style={{ width: DUE_DATE_COLUMN_WIDTH }} />,
                    <col key="right-note" style={{ width: NOTE_COLUMN_WIDTH }} />
                  ])
                : null}
            </colgroup>
            <thead className="sticky top-0 bg-slate-900">
              <tr className="border-b border-white/20 text-xs font-semibold text-white/80">
                <th className="px-2 py-3 text-center">完了</th>
                {tableColumns.map((column) => (
                  <th key={`head-left-${column.key}`} className="px-2 py-3">
                    {column.label}
                  </th>
                ))}
                <th className="px-2 py-3">納期日</th>
                <th className="px-2 py-3">備考</th>
                {isTwoColumn ? <th aria-hidden className="px-2 py-3" /> : null}
                {isTwoColumn ? <th className="px-2 py-3 text-center">完了</th> : null}
                {isTwoColumn
                  ? tableColumns.map((column) => (
                      <th key={`head-right-${column.key}`} className="px-2 py-3">
                        {column.label}
                      </th>
                    ))
                  : null}
                {isTwoColumn ? <th className="px-2 py-3">納期日</th> : null}
                {isTwoColumn ? <th className="px-2 py-3">備考</th> : null}
              </tr>
            </thead>
            <tbody>
              {rowPairs.map(([left, right]) => {
                const leftClass = left?.isCompleted ? 'opacity-50 grayscale' : '';
                const rightClass = right?.isCompleted ? 'opacity-50 grayscale' : '';
                return (
                  <tr key={`row-${left.id}`} className="border-b border-white/10">
                    <td className={`px-2 py-1.5 align-middle ${leftClass}`}>
                      <button
                        className={`flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white text-black shadow hover:bg-slate-100 disabled:opacity-60 ${
                          left.isCompleted ? 'border-slate-400' : 'border-red-500'
                        }`}
                        aria-label={left.isCompleted ? '未完了に戻す' : '完了にする'}
                        onClick={() => handleComplete(left.id)}
                        disabled={completeMutation.isPending}
                      >
                        ✓
                      </button>
                    </td>
                    {tableColumns.map((column) => (
                      <td key={`left-${left.id}-${column.key}`} className={`px-2 py-1.5 ${leftClass}`}>
                        {column.key === 'processingOrder' ? (
                          (() => {
                            const resourceCd = left.data.FSIGENCD ?? '';
                            const options = getAvailableOrders(resourceCd, left.processingOrder);
                            return (
                              <select
                                value={left.processingOrder ?? ''}
                                onChange={(event) => handleOrderChange(left.id, resourceCd, event.target.value)}
                                disabled={
                                  completeMutation.isPending ||
                                  left.isCompleted ||
                                  resourceCd.length === 0 ||
                                  orderMutation.isPending
                                }
                                className="h-7 w-16 rounded border border-slate-300 bg-white px-2 text-sm text-black"
                              >
                                <option value="">-</option>
                                {options.map((num) => (
                                  <option key={num} value={num}>
                                    {num}
                                  </option>
                                ))}
                              </select>
                            );
                          })()
                        ) : column.key === 'processingType' ? (
                          <select
                            value={left.processingType ?? ''}
                            onChange={(event) => handleProcessingChange(left.id, event.target.value)}
                            disabled={completeMutation.isPending || left.isCompleted || processingMutation.isPending}
                            className="h-7 w-24 rounded border border-slate-300 bg-white px-2 text-sm text-black"
                          >
                            <option value="">-</option>
                            {PROCESSING_TYPES.map((value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={[
                              column.key === 'ProductNo' || column.key === 'FSIGENCD' ? 'font-mono' : '',
                              column.key === 'ProductNo' || column.key === 'FHINCD' ? 'break-all' : ''
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {left.values[column.key] || '-'}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className={`px-2 py-1.5 align-middle ${leftClass}`}>
                      <span className="flex items-center gap-1">
                        <span
                          className="min-w-0 truncate text-white/90"
                          title={left.dueDate ? formatDueDate(left.dueDate) : undefined}
                        >
                          {formatDueDate(left.dueDate)}
                        </span>
                        <button
                          type="button"
                          onClick={() => openDueDatePicker(left.id, left.dueDate)}
                          disabled={dueDateMutation.isPending}
                          className="flex shrink-0 items-center justify-center rounded p-1 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-50"
                          aria-label="納期日を編集"
                        >
                          <CalendarIcon />
                        </button>
                      </span>
                    </td>
                    <td className={`px-2 py-1.5 align-middle ${leftClass}`}>
                      <span className="flex w-full items-center gap-1 min-w-0" title={left.note ?? undefined}>
                        <span
                          className="min-w-0 flex-1 text-white/90 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden whitespace-normal break-words"
                        >
                          {left.note ?? ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => startNoteEdit(left.id, left.note)}
                          disabled={noteMutation.isPending}
                          className="flex shrink-0 items-center justify-center rounded p-1 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-50"
                          aria-label="備考を編集"
                        >
                          <PencilIcon />
                        </button>
                      </span>
                    </td>
                    {isTwoColumn ? <td className="px-2 py-1.5" /> : null}
                    {isTwoColumn ? (
                      <>
                        <td className={`px-2 py-1.5 align-middle ${rightClass}`}>
                          {right ? (
                            <button
                              className={`flex h-7 w-7 items-center justify-center rounded-full border-2 bg-white text-black shadow hover:bg-slate-100 disabled:opacity-60 ${
                                right.isCompleted ? 'border-slate-400' : 'border-red-500'
                              }`}
                              aria-label={right.isCompleted ? '未完了に戻す' : '完了にする'}
                              onClick={() => handleComplete(right.id)}
                              disabled={completeMutation.isPending}
                            >
                              ✓
                            </button>
                          ) : null}
                        </td>
                        {tableColumns.map((column) => (
                          <td key={`right-${right?.id ?? 'empty'}-${column.key}`} className={`px-2 py-1.5 ${rightClass}`}>
                            {right ? (
                              column.key === 'processingOrder' ? (
                                (() => {
                                  const resourceCd = right.data.FSIGENCD ?? '';
                                  const options = getAvailableOrders(resourceCd, right.processingOrder);
                                  return (
                                    <select
                                      value={right.processingOrder ?? ''}
                                      onChange={(event) => handleOrderChange(right.id, resourceCd, event.target.value)}
                                      disabled={
                                        completeMutation.isPending ||
                                        right.isCompleted ||
                                        resourceCd.length === 0 ||
                                        orderMutation.isPending
                                      }
                                      className="h-7 w-16 rounded border border-slate-300 bg-white px-2 text-sm text-black"
                                    >
                                      <option value="">-</option>
                                      {options.map((num) => (
                                        <option key={num} value={num}>
                                          {num}
                                        </option>
                                      ))}
                                    </select>
                                  );
                                })()
                              ) : column.key === 'processingType' ? (
                                <select
                                  value={right.processingType ?? ''}
                                  onChange={(event) => handleProcessingChange(right.id, event.target.value)}
                                  disabled={completeMutation.isPending || right.isCompleted || processingMutation.isPending}
                                  className="h-7 w-24 rounded border border-slate-300 bg-white px-2 text-sm text-black"
                                >
                                  <option value="">-</option>
                                  {PROCESSING_TYPES.map((value) => (
                                    <option key={value} value={value}>
                                      {value}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  className={[
                                    column.key === 'ProductNo' || column.key === 'FSIGENCD' ? 'font-mono' : '',
                                    column.key === 'ProductNo' || column.key === 'FHINCD' ? 'break-all' : ''
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                >
                                  {right.values[column.key] || '-'}
                                </span>
                              )
                            ) : null}
                          </td>
                        ))}
                        <td className={`px-2 py-1.5 align-middle ${rightClass}`}>
                          {right ? (
                            <span className="flex items-center gap-1">
                              <span
                                className="min-w-0 truncate text-white/90"
                                title={right.dueDate ? formatDueDate(right.dueDate) : undefined}
                              >
                                {formatDueDate(right.dueDate)}
                              </span>
                              <button
                                type="button"
                                onClick={() => openDueDatePicker(right.id, right.dueDate)}
                                disabled={dueDateMutation.isPending}
                                className="flex shrink-0 items-center justify-center rounded p-1 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-50"
                                aria-label="納期日を編集"
                              >
                                <CalendarIcon />
                              </button>
                            </span>
                          ) : null}
                        </td>
                        <td className={`px-2 py-1.5 align-middle ${rightClass}`}>
                          {right ? (
                            <span className="flex w-full items-center gap-1 min-w-0" title={right.note ?? undefined}>
                              <span
                                className="min-w-0 flex-1 text-white/90 [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden whitespace-normal break-words"
                              >
                                {right.note ?? ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => startNoteEdit(right.id, right.note)}
                                disabled={noteMutation.isPending}
                                className="flex shrink-0 items-center justify-center rounded p-1 text-white/70 hover:bg-white/20 hover:text-white disabled:opacity-50"
                                aria-label="備考を編集"
                              >
                                <PencilIcon />
                              </button>
                            </span>
                          ) : null}
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

