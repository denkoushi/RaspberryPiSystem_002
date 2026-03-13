import { useCallback, useState } from 'react';

type CommitNoteInput = {
  rowId: string;
  note: string;
  onSettled: () => void;
};

type CommitDueDateInput = {
  rowId: string;
  dueDate: string;
  onSettled: () => void;
};

type Params = {
  onCommitNote: (input: CommitNoteInput) => void;
  onCommitDueDate: (input: CommitDueDateInput) => void;
};

const normalizeDueDateInput = (value: string | null) => {
  if (!value) return '';
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
};

export const useMutationFeedback = ({ onCommitNote, onCommitDueDate }: Params) => {
  const [editingNoteRowId, setEditingNoteRowId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState('');
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [editingDueDateRowId, setEditingDueDateRowId] = useState<string | null>(null);
  const [editingDueDateValue, setEditingDueDateValue] = useState('');
  const [isDueDatePickerOpen, setIsDueDatePickerOpen] = useState(false);

  const closeNoteModal = useCallback(() => {
    setEditingNoteRowId(null);
    setEditingNoteValue('');
    setIsNoteModalOpen(false);
  }, []);

  const startNoteEdit = useCallback((rowId: string, currentNote: string | null) => {
    setEditingNoteRowId(rowId);
    setEditingNoteValue(currentNote ?? '');
    setIsNoteModalOpen(true);
  }, []);

  const commitNote = useCallback(
    (nextValue: string) => {
      if (!editingNoteRowId) return;
      setEditingNoteValue(nextValue);
      onCommitNote({
        rowId: editingNoteRowId,
        note: nextValue,
        onSettled: closeNoteModal
      });
    },
    [closeNoteModal, editingNoteRowId, onCommitNote]
  );

  const closeDueDatePicker = useCallback(() => {
    setIsDueDatePickerOpen(false);
    setEditingDueDateRowId(null);
    setEditingDueDateValue('');
  }, []);

  const openDueDatePicker = useCallback((rowId: string, currentDueDate: string | null) => {
    setEditingDueDateRowId(rowId);
    setEditingDueDateValue(normalizeDueDateInput(currentDueDate));
    setIsDueDatePickerOpen(true);
  }, []);

  const commitDueDate = useCallback(
    (nextValue: string) => {
      if (!editingDueDateRowId) return;
      setEditingDueDateValue(nextValue);
      onCommitDueDate({
        rowId: editingDueDateRowId,
        dueDate: nextValue,
        onSettled: closeDueDatePicker
      });
    },
    [closeDueDatePicker, editingDueDateRowId, onCommitDueDate]
  );

  return {
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
  };
};
