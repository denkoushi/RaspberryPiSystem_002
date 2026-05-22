import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  useSetKioskProductionScheduleRowCompletion,
  useUpdateKioskProductionScheduleDueDate,
  useUpdateKioskProductionScheduleNote,
  useUpdateKioskProductionScheduleOrder,
  useUpdateKioskProductionScheduleProcessing,
  type KioskProductionScheduleOrderCachePolicy
} from '../../../api/hooks';

import type { ProductionScheduleWriteSuccessListeners } from './productionScheduleWriteSuccessListeners';
import type { KioskProductionScheduleCompletionIntent } from '../../../api/client';

/** 書き込み直後のリスト再取得とポーリング復帰が重ならないよう空ける（体感待ちと Pi 負荷のバランス）。 */
const WRITE_REFETCH_COOLDOWN_MS = 1800;

export type UseProductionScheduleMutationsParams = {
  isSearchStateWriting: boolean;
  noteMaxLength: number;
  /** Mac + manual-order v2: 手動順番の書き込み先端末 */
  productionScheduleTargetDeviceScopeKey?: string;
  /** 順位ボード等: 一覧の full invalidate を避ける fast path */
  productionScheduleOrderCachePolicy?: KioskProductionScheduleOrderCachePolicy;
  /** 書き込み成功後の任意副作用（端末キャッシュミラー等） */
  writeSuccessListeners?: ProductionScheduleWriteSuccessListeners;
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
};

type UpdateOrderAsyncParams = {
  rowId: string;
  resourceCd: string;
  orderNumber: number | null;
};

const sanitizeNote = (value: string, noteMaxLength: number) => {
  return value.replace(/\r?\n/g, '').trim().slice(0, noteMaxLength);
};

export const useProductionScheduleMutations = ({
  isSearchStateWriting,
  noteMaxLength,
  productionScheduleTargetDeviceScopeKey,
  productionScheduleOrderCachePolicy,
  writeSuccessListeners
}: UseProductionScheduleMutationsParams) => {
  const writeSuccessListenersRef = useRef(writeSuccessListeners);
  writeSuccessListenersRef.current = writeSuccessListeners;
  const completeMutation = useSetKioskProductionScheduleRowCompletion();
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

  const updateOrder = useCallback(
    ({ rowId, resourceCd, nextValue }: UpdateOrderParams) => {
      const orderNumber = nextValue.length > 0 ? Number(nextValue) : null;
      orderMutation.mutate(
        {
          rowId,
          payload: {
            resourceCd,
            orderNumber,
            ...(productionScheduleTargetDeviceScopeKey
              ? { targetDeviceScopeKey: productionScheduleTargetDeviceScopeKey }
              : {})
          },
          cachePolicy: productionScheduleOrderCachePolicy ?? 'default'
        },
        {
          onSuccess: (data) => {
            writeSuccessListenersRef.current?.onOrderSuccess?.({
              rowId,
              orderNumber: data.orderNumber ?? null
            });
          }
        }
      );
    },
    [orderMutation, productionScheduleOrderCachePolicy, productionScheduleTargetDeviceScopeKey]
  );

  const updateOrderAsync = useCallback(
    async ({ rowId, resourceCd, orderNumber }: UpdateOrderAsyncParams) => {
      const data = await orderMutation.mutateAsync({
        rowId,
        payload: {
          resourceCd,
          orderNumber,
          ...(productionScheduleTargetDeviceScopeKey
            ? { targetDeviceScopeKey: productionScheduleTargetDeviceScopeKey }
            : {})
        },
        cachePolicy: productionScheduleOrderCachePolicy ?? 'default'
      });
      writeSuccessListenersRef.current?.onOrderSuccess?.({
        rowId,
        orderNumber: data.orderNumber ?? null
      });
      return;
    },
    [orderMutation, productionScheduleOrderCachePolicy, productionScheduleTargetDeviceScopeKey]
  );

  const updateProcessing = useCallback(
    (rowId: string, nextValue: string) => {
      processingMutation.mutate({ rowId, processingType: nextValue });
    },
    [processingMutation]
  );

  const saveNote = useCallback(
    ({ rowId, note, onSettled }: SaveNoteParams) => {
      if (noteMutation.isPending) return;
      const sanitized = sanitizeNote(note, noteMaxLength);
      noteMutation.mutate(
        { rowId, note: sanitized },
        {
          onSuccess: (data) => {
            writeSuccessListenersRef.current?.onNoteSuccess?.({
              rowId,
              note: data.note ?? null
            });
          },
          onSettled
        }
      );
    },
    [noteMaxLength, noteMutation]
  );

  const commitDueDate = useCallback(
    ({ rowId, dueDate, onSettled }: CommitDueDateParams) => {
      if (dueDateMutation.isPending) return;
      dueDateMutation.mutate(
        { rowId, dueDate },
        {
          onSuccess: (data) => {
            writeSuccessListenersRef.current?.onDueDateSuccess?.({
              rowId,
              dueDate: data.dueDate ?? null
            });
          },
          onSettled
        }
      );
    },
    [dueDateMutation]
  );

  const completeRow = useCallback(
    async (rowId: string, intent: KioskProductionScheduleCompletionIntent) => {
      const data = await completeMutation.mutateAsync({ rowId, intent });
      if (data?.rowData != null) {
        writeSuccessListenersRef.current?.onCompletionSuccess?.({
          rowId,
          rowData: data.rowData as Record<string, unknown>
        });
      }
      return data;
    },
    [completeMutation]
  );

  return {
    ...pending,
    isWriting,
    isWriteCooldown,
    pauseRefetch,
    orderError: orderMutation.isError ? orderMutation.error : null,
    resetOrderError: () => orderMutation.reset(),
    updateOrder,
    updateOrderAsync,
    updateProcessing,
    saveNote,
    commitDueDate,
    completeRow
  };
};
