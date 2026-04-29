import { useCallback, useEffect, useState } from 'react';

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
  const updateProcessingDueDateMutation = useUpdateKioskProductionScheduleDueManagementSeibanProcessingDueDate();

  const [searchInput, setSearchInput] = useState('');
  /** 納期アシスト詳細・日付ピッカー対象の単一製番 */
  const [selectedFseiban, setSelectedFseiban] = useState<string | null>(null);
  /** 一覧 OR 検索（`activeQueries`）用。詳細とは独立 */
  const [selectedFseibanFilters, setSelectedFseibanFilters] = useState<string[]>(
    () => [...(options?.initialSeibanFilters ?? [])].filter((s) => s.trim().length > 0)
  );

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

  useEffect(() => {
    if (!searchStateQuery.isSuccess) return;
    setSelectedFseibanFilters((prev) => {
      const next = prev.filter((item) => sharedHistory.includes(item));
      if (next.length === prev.length) return prev;
      return next;
    });
  }, [searchStateQuery.isSuccess, sharedHistory]);

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

  const toggleFseibanFilter = useCallback((fseiban: string) => {
    const trimmed = fseiban.trim();
    if (!trimmed.length) return;

    setSelectedFseibanFilters((prevFilters) => {
      const nextFilters = toggleSeibanFilter(prevFilters, trimmed);
      setSelectedFseiban((prevDetail) => {
        const wasIn = prevFilters.includes(trimmed);
        const nowIn = nextFilters.includes(trimmed);
        if (nowIn && !wasIn) return trimmed;
        if (!nowIn && prevDetail === trimmed) return nextFilters[0] ?? null;
        return prevDetail;
      });
      return nextFilters;
    });
  }, []);

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
    historyWriting
  };
}

export type LeaderBoardDueAssistHandle = ReturnType<typeof useLeaderBoardDueAssist>;
