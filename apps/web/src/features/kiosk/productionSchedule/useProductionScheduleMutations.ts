import { useEffect, useMemo, useRef, useState } from 'react';

import {
  useCompleteKioskProductionScheduleRow,
  useUpdateKioskProductionScheduleDueDate,
  useUpdateKioskProductionScheduleNote,
  useUpdateKioskProductionScheduleOrder,
  useUpdateKioskProductionScheduleProcessing
} from '../../../api/hooks';

const WRITE_REFETCH_COOLDOWN_MS = 2500;

type Params = {
  isSearchStateWriting: boolean;
  noteMaxLength: number;
};

type SaveNoteParams = {
  rowId: string;
  note: string;
  onSettled?: () => void;
};

type CommitDueDateParams = {
  rowId: string;
  dueDate: string;
  onSettled?: () => void;
};

type UpdateOrderParams = {
  rowId: string;
  resourceCd: string;
  nextValue: string;
  targetLocation?: string;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
};

const sanitizeNote = (value: string, noteMaxLength: number) => {
  return value.replace(/\r?\n/g, '').trim().slice(0, noteMaxLength);
};

export const useProductionScheduleMutations = ({ isSearchStateWriting, noteMaxLength }: Params) => {
  const completeMutation = useCompleteKioskProductionScheduleRow();
  const orderMutation = useUpdateKioskProductionScheduleOrder();
  const processingMutation = useUpdateKioskProductionScheduleProcessing();
  const noteMutation = useUpdateKioskProductionScheduleNote();
  const dueDateMutation = useUpdateKioskProductionScheduleDueDate();

  const isWriting =
    completeMutation.isPending ||
    orderMutation.isPending ||
    processingMutation.isPending ||
    noteMutation.isPending ||
    dueDateMutation.isPending ||
    isSearchStateWriting;

  const [isWriteCooldown, setIsWriteCooldown] = useState(false);
  const prevIsWritingRef = useRef(false);
  const cooldownTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const prevIsWriting = prevIsWritingRef.current;
    prevIsWritingRef.current = isWriting;

    if (isWriting) {
      if (cooldownTimerRef.current) {
        window.clearTimeout(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      setIsWriteCooldown(false);
      return;
    }

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

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) {
        window.clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  const pauseRefetch = isWriting || isWriteCooldown;

  const pending = useMemo(
    () => ({
      completePending: completeMutation.isPending,
      orderPending: orderMutation.isPending,
      processingPending: processingMutation.isPending,
      notePending: noteMutation.isPending,
      dueDatePending: dueDateMutation.isPending
    }),
    [
      completeMutation.isPending,
      dueDateMutation.isPending,
      noteMutation.isPending,
      orderMutation.isPending,
      processingMutation.isPending
    ]
  );

  const updateOrder = ({
    rowId,
    resourceCd,
    nextValue,
    targetLocation,
    onSuccess,
    onError
  }: UpdateOrderParams) => {
    const orderNumber = nextValue.length > 0 ? Number(nextValue) : null;
    const payload = {
      resourceCd,
      orderNumber,
      ...(targetLocation ? { targetLocation } : {})
    };
    const variables = { rowId, payload };
    if (onSuccess || onError) {
      orderMutation.mutate(variables, { onSuccess, onError });
      return;
    }
    orderMutation.mutate(variables);
  };

  const updateProcessing = (rowId: string, nextValue: string) => {
    processingMutation.mutate({ rowId, processingType: nextValue });
  };

  const saveNote = ({ rowId, note, onSettled }: SaveNoteParams) => {
    if (noteMutation.isPending) return;
    noteMutation.mutate(
      { rowId, note: sanitizeNote(note, noteMaxLength) },
      {
        onSettled
      }
    );
  };

  const commitDueDate = ({ rowId, dueDate, onSettled }: CommitDueDateParams) => {
    if (dueDateMutation.isPending) return;
    dueDateMutation.mutate(
      { rowId, dueDate },
      {
        onSettled
      }
    );
  };

  const completeRow = async (rowId: string) => {
    await completeMutation.mutateAsync(rowId);
  };

  return {
    ...pending,
    isWriting,
    isWriteCooldown,
    pauseRefetch,
    updateOrder,
    updateProcessing,
    saveNote,
    commitDueDate,
    completeRow
  };
};
