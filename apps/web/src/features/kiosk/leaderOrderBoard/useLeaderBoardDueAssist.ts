import { useEffect, useCallback, useState } from 'react';

import {
  useKioskProductionScheduleDueManagementSeibanDetail,
  useUpdateKioskProductionScheduleDueManagementSeibanDueDate,
  useUpdateKioskProductionScheduleDueManagementSeibanProcessingDueDate
} from '../../../api/hooks';
import { normalizeDueDateInput } from '../productionSchedule/dueManagement';
import { useKioskSharedSearchHistoryActions } from '../productionSchedule/useKioskSharedSearchHistoryActions';

type DueDateTarget = { scope: 'seiban' } | { scope: 'processing'; processingType: string };

export function useLeaderBoardDueAssist(options?: { pauseRefetch?: boolean }) {
  const {
    sharedHistory,
    historyWriting,
    addSeibanToHistory,
    removeSeibanFromHistory
  } = useKioskSharedSearchHistoryActions({ pauseRefetch: options?.pauseRefetch });
  const updateSeibanDueDateMutation = useUpdateKioskProductionScheduleDueManagementSeibanDueDate();
  const updateProcessingDueDateMutation = useUpdateKioskProductionScheduleDueManagementSeibanProcessingDueDate();

  const [searchInput, setSearchInput] = useState('');
  const [selectedFseiban, setSelectedFseiban] = useState<string | null>(null);
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

  const applySearch = async () => {
    const trimmed = searchInput.trim();
    if (trimmed.length === 0) return;
    try {
      await addSeibanToHistory(trimmed);
      setSelectedFseiban(trimmed);
      setSearchInput('');
      setIsDetailOpen(true);
    } catch {
      /* 履歴保存失敗時は選択状態を変えない（未処理拒否を防ぐ） */
    }
  };

  const selectFseiban = (fseiban: string) => {
    setSelectedFseiban(fseiban);
    setIsDetailOpen(true);
  };

  const removeFromHistory = async (fseiban: string) => {
    const nextAfterRemove = sharedHistory.filter((item) => item !== fseiban);
    try {
      await removeSeibanFromHistory(fseiban);
      if (selectedFseiban === fseiban) {
        setSelectedFseiban(nextAfterRemove[0] ?? null);
      }
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
