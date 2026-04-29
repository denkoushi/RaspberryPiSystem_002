import { useCallback, useEffect, useRef, useState } from 'react';

import {
  useKioskProductionScheduleDueManagementSeibanDetail,
  useUpdateKioskProductionScheduleDueManagementSeibanDueDate,
  useUpdateKioskProductionScheduleDueManagementSeibanProcessingDueDate
} from '../../../api/hooks';
import { normalizeDueDateInput } from '../productionSchedule/dueManagement';
import { useKioskSharedSearchHistoryActions } from '../productionSchedule/useKioskSharedSearchHistoryActions';

import {
  ensureSeibanInFilters,
  isSeibanFilterSelected,
  toggleSeibanFilter
} from './leaderBoardSeibanFilterModel';
import { requiresSharedHistoryInsertBeforeEnableFilter } from './leaderBoardSharedHistoryGate';

type DueDateTarget = { scope: 'seiban' } | { scope: 'processing'; processingType: string };

export function useLeaderBoardDueAssist(options?: {
  pauseRefetch?: boolean;
  refetchIntervalMs?: number | false;
  /** `searchConditions.activeQueries` から復元する初回のみ（localStorage 等） */
  initialSeibanFilters?: readonly string[];
}) {
  const {
    sharedHistory,
    searchStateQuery,
    historyWriting,
    addSeibanToHistory,
    removeSeibanFromHistory
  } = useKioskSharedSearchHistoryActions({
    pauseRefetch: options?.pauseRefetch,
    refetchIntervalMs: options?.refetchIntervalMs
  });
  const updateSeibanDueDateMutation = useUpdateKioskProductionScheduleDueManagementSeibanDueDate();
  const updateProcessingDueDateMutation =
    useUpdateKioskProductionScheduleDueManagementSeibanProcessingDueDate();

  const [searchInput, setSearchInput] = useState('');
  /** 納期アシスト詳細・日付ピッカー対象の単一製番 */
  const [selectedFseiban, setSelectedFseiban] = useState<string | null>(null);
  /** 一覧 OR 検索（`activeQueries`）用。詳細とは独立 */
  const [selectedFseibanFilters, setSelectedFseibanFilters] = useState<string[]>(
    () => [...(options?.initialSeibanFilters ?? [])].filter((s) => s.trim().length > 0)
  );

  const selectedFseibanFiltersRef = useRef(selectedFseibanFilters);
  selectedFseibanFiltersRef.current = selectedFseibanFilters;

  const sharedHistoryRef = useRef(sharedHistory);
  sharedHistoryRef.current = sharedHistory;

  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [editingDueDate, setEditingDueDate] = useState('');
  const [editingDueDateTarget, setEditingDueDateTarget] = useState<DueDateTarget>({ scope: 'seiban' });

  const openDetail = useCallback(() => setIsDetailOpen(true), []);
  const closeDetail = useCallback(() => setIsDetailOpen(false), []);

  const detailQuery = useKioskProductionScheduleDueManagementSeibanDetail(selectedFseiban);

  useEffect(() => {
    if (selectedFseiban == null) return;
    if (!sharedHistory.includes(selectedFseiban)) {
      setSelectedFseiban(sharedHistory[0] ?? null);
    }
  }, [sharedHistory, selectedFseiban]);

  /**
   * search-state 取得完了後に1回だけ: ローカル復元フィルタのうちサーバ履歴に無い製番を登録する。
   * （旧「sharedHistory に無いフィルタを即削除」ロジックは、ハイドレート前にチップが消えるため廃止）
   */
  const didHydrateLocalFiltersRef = useRef(false);
  useEffect(() => {
    if (!searchStateQuery.isSuccess || didHydrateLocalFiltersRef.current) {
      return;
    }

    const orphans = selectedFseibanFiltersRef.current.filter(
      (f) => !sharedHistoryRef.current.includes(f)
    );
    if (orphans.length === 0) {
      didHydrateLocalFiltersRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        for (const f of orphans) {
          if (cancelled) return;
          await addSeibanToHistory(f);
        }
        didHydrateLocalFiltersRef.current = true;
      } catch {
        /* 失敗時は再試行のためフラグを立てない（同一セッションで search を再度取得できれば再度試せる） */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchStateQuery.isSuccess, addSeibanToHistory, sharedHistory]);

  const applySearch = async () => {
    const trimmed = searchInput.trim();
    if (trimmed.length === 0) return;
    try {
      await addSeibanToHistory(trimmed);
      setSelectedFseiban(trimmed);
      setSelectedFseibanFilters((prev) => ensureSeibanInFilters(prev, trimmed));
      setSearchInput('');
      setIsDetailOpen(true);
    } catch {
      /* 履歴保存失敗時は選択状態を変えない（未処理拒否を防ぐ） */
    }
  };

  /** 詳細だけ開きたいとき（一覧フィルタは変えない） */
  const selectFseiban = (fseiban: string) => {
    setSelectedFseiban(fseiban);
    setIsDetailOpen(true);
  };

  const toggleFseibanFilter = useCallback(
    async (fseiban: string) => {
      const trimmed = fseiban.trim();
      if (!trimmed.length) return;

      const prevFilters = selectedFseibanFiltersRef.current;
      const wasSelected = isSeibanFilterSelected(prevFilters, trimmed);

      if (wasSelected) {
        setSelectedFseibanFilters((prevFiltersInner) => {
          const nextFilters = toggleSeibanFilter(prevFiltersInner, trimmed);
          setSelectedFseiban((prevDetail) => {
            const wasIn = prevFiltersInner.includes(trimmed);
            const nowIn = nextFilters.includes(trimmed);
            if (nowIn && !wasIn) return trimmed;
            if (!nowIn && prevDetail === trimmed) return nextFilters[0] ?? null;
            return prevDetail;
          });
          return nextFilters;
        });
        return;
      }

      if (requiresSharedHistoryInsertBeforeEnableFilter(sharedHistoryRef.current, trimmed)) {
        try {
          await addSeibanToHistory(trimmed);
        } catch {
          return;
        }
      }

      setSelectedFseibanFilters((prevFiltersInner) => toggleSeibanFilter(prevFiltersInner, trimmed));
      setSelectedFseiban(trimmed);
    },
    [addSeibanToHistory]
  );

  const clearFseibanFilters = useCallback(() => {
    setSelectedFseibanFilters([]);
  }, []);

  const removeFromHistory = async (fseiban: string) => {
    const nextAfterRemove = sharedHistory.filter((item) => item !== fseiban);
    try {
      await removeSeibanFromHistory(fseiban);
      setSelectedFseibanFilters((prev) => prev.filter((x) => x !== fseiban));
      setSelectedFseiban((prev) => (prev === fseiban ? nextAfterRemove[0] ?? null : prev));
    } catch {
      /* 同上 */
    }
  };

  /** 一覧フィルタや詳細表示は変更せず、共有製番履歴のみへ追加する */
  const registerSeibanToSharedHistory = useCallback(
    async (fseiban: string) => {
      const trimmed = fseiban.trim();
      if (!trimmed.length) return;
      await addSeibanToHistory(trimmed);
    },
    [addSeibanToHistory]
  );

  const openSeibanDueDatePicker = () => {
    if (!detailQuery.data?.fseiban) return;
    setEditingDueDateTarget({ scope: 'seiban' });
    setEditingDueDate(normalizeDueDateInput(detailQuery.data.dueDate));
    setIsDatePickerOpen(true);
  };

  const openProcessingDueDatePicker = (processingType: string, dueDate: string | null) => {
    if (!detailQuery.data?.fseiban) return;
    setEditingDueDateTarget({ scope: 'processing', processingType });
    setEditingDueDate(normalizeDueDateInput(dueDate));
    setIsDatePickerOpen(true);
  };

  const commitDueDate = async (nextDueDate: string) => {
    const fseiban = detailQuery.data?.fseiban;
    if (!fseiban) return;

    try {
      if (editingDueDateTarget.scope === 'seiban') {
        await updateSeibanDueDateMutation.mutateAsync({ fseiban, dueDate: nextDueDate });
      } else {
        await updateProcessingDueDateMutation.mutateAsync({
          fseiban,
          processingType: editingDueDateTarget.processingType,
          dueDate: nextDueDate
        });
      }
      setIsDatePickerOpen(false);
    } catch {
      /* 失敗時はモーダルを開いたままにし、未処理拒否を防ぐ */
    }
  };

  return {
    searchInput,
    setSearchInput,
    selectedFseiban,
    /** OR 検索（一覧 `activeQueries` と同期する想定） */
    selectedFseibanFilters,
    toggleFseibanFilter,
    clearFseibanFilters,
    isFseibanFilterSelected: (fseiban: string) => isSeibanFilterSelected(selectedFseibanFilters, fseiban),
    sharedHistory,
    isDetailOpen,
    openDetail,
    closeDetail,
    selectFseiban,
    applySearch,
    removeFromHistory,
    detailQuery,
    openSeibanDueDatePicker,
    openProcessingDueDatePicker,
    isDatePickerOpen,
    editingDueDate,
    closeDatePicker: () => setIsDatePickerOpen(false),
    commitDueDate,
    dueUpdatePending: updateSeibanDueDateMutation.isPending || updateProcessingDueDateMutation.isPending,
    historyWriting,
    registerSeibanToSharedHistory
  };
}

export type LeaderBoardDueAssistHandle = ReturnType<typeof useLeaderBoardDueAssist>;
