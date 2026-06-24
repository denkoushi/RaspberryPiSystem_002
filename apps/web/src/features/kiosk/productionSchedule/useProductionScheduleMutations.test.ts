import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProductionScheduleMutations } from './useProductionScheduleMutations';

const completeMutation = {
  isPending: false,
  mutateAsync: vi.fn(async (_args: { rowId: string; intent: 'complete' | 'incomplete' }) => undefined)
};
const orderMutation = {
  isPending: false,
  isError: false,
  error: null as Error | null,
  reset: vi.fn(),
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({ orderNumber: 1 }))
};
const processingMutation = {
  isPending: false,
  mutate: vi.fn()
};
const noteMutation = {
  isPending: false,
  mutate: vi.fn()
};
const dueDateMutation = {
  isPending: false,
  mutate: vi.fn()
};

const splitOrderMutation = {
  isPending: false,
  isError: false,
  error: null as Error | null,
  reset: vi.fn(),
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({ orderNumber: 1 }))
};
const splitDueDateMutation = {
  isPending: false,
  mutate: vi.fn()
};

vi.mock('../../../api/hooks', () => ({
  useSetKioskProductionScheduleRowCompletion: () => completeMutation,
  useUpdateKioskProductionScheduleOrder: () => orderMutation,
  useUpdateKioskProductionScheduleSplitOrder: () => splitOrderMutation,
  useUpdateKioskProductionScheduleProcessing: () => processingMutation,
  useUpdateKioskProductionScheduleNote: () => noteMutation,
  useUpdateKioskProductionScheduleDueDate: () => dueDateMutation,
  useUpdateKioskProductionScheduleSplitDueDate: () => splitDueDateMutation
}));

describe('useProductionScheduleMutations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    completeMutation.isPending = false;
    orderMutation.isPending = false;
    orderMutation.isError = false;
    orderMutation.error = null;
    splitOrderMutation.isPending = false;
    splitOrderMutation.isError = false;
    splitOrderMutation.error = null;
    processingMutation.isPending = false;
    noteMutation.isPending = false;
    dueDateMutation.isPending = false;
    splitDueDateMutation.isPending = false;
    completeMutation.mutateAsync.mockClear();
    orderMutation.mutate.mockClear();
    orderMutation.mutateAsync.mockClear();
    orderMutation.reset.mockClear();
    splitOrderMutation.reset.mockClear();
    processingMutation.mutate.mockClear();
    noteMutation.mutate.mockClear();
    dueDateMutation.mutate.mockClear();
  });

  it('書き込み終了後に pauseRefetch のクールダウンを維持する', () => {
    const { result, rerender, unmount } = renderHook(
      ({ isSearchStateWriting }) =>
        useProductionScheduleMutations({
          isSearchStateWriting,
          noteMaxLength: 100
        }),
      {
        initialProps: { isSearchStateWriting: false }
      }
    );

    expect(result.current.pauseRefetch).toBe(false);

    orderMutation.isPending = true;
    rerender({ isSearchStateWriting: false });
    expect(result.current.pauseRefetch).toBe(true);

    orderMutation.isPending = false;
    rerender({ isSearchStateWriting: false });
    expect(result.current.pauseRefetch).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(result.current.pauseRefetch).toBe(false);
    unmount();
  });

  it('saveNote で改行除去・trim・最大長制限を適用する', () => {
    const { result, unmount } = renderHook(() =>
      useProductionScheduleMutations({
        isSearchStateWriting: false,
        noteMaxLength: 5
      })
    );

    const onSettled = vi.fn();
    act(() => {
      result.current.saveNote({
        rowId: 'row-1',
        note: '  a\nbcdef  ',
        onSettled
      });
    });

    expect(noteMutation.mutate).toHaveBeenCalledTimes(1);
    expect(noteMutation.mutate).toHaveBeenCalledWith(
      { rowId: 'row-1', note: 'abcde' },
      expect.objectContaining({ onSettled, onSuccess: expect.any(Function) })
    );
    unmount();
  });

  it('updateOrder で空文字を null に変換する', () => {
    const { result, unmount } = renderHook(() =>
      useProductionScheduleMutations({
        isSearchStateWriting: false,
        noteMaxLength: 100
      })
    );

    act(() => {
      result.current.updateOrder({
        rowId: 'row-1',
        resourceCd: 'R01',
        nextValue: ''
      });
    });

    expect(orderMutation.mutate).toHaveBeenCalledWith(
      {
        rowId: 'row-1',
        payload: {
          resourceCd: 'R01',
          orderNumber: null
        },
        cachePolicy: 'default'
      },
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    unmount();
  });

  it('updateOrderAsync は orderNumber をそのまま mutateAsync へ渡す', async () => {
    const { result, unmount } = renderHook(() =>
      useProductionScheduleMutations({
        isSearchStateWriting: false,
        noteMaxLength: 100,
        productionScheduleOrderCachePolicy: 'leaderBoardFastPath'
      })
    );

    await act(async () => {
      await result.current.updateOrderAsync({
        rowId: 'row-2',
        resourceCd: 'R02',
        orderNumber: 3
      });
    });

    expect(orderMutation.mutateAsync).toHaveBeenCalledWith({
      rowId: 'row-2',
      payload: {
        resourceCd: 'R02',
        orderNumber: 3
      },
      cachePolicy: 'leaderBoardFastPath'
    });
    unmount();
  });

  it('splitOrderMutation のエラーを orderError として返す', () => {
    const splitError = new Error('ORDER_NUMBER_CONFLICT');
    splitOrderMutation.isError = true;
    splitOrderMutation.error = splitError;

    const { result, unmount } = renderHook(() =>
      useProductionScheduleMutations({
        isSearchStateWriting: false,
        noteMaxLength: 100
      })
    );

    expect(result.current.orderError).toBe(splitError);

    act(() => {
      result.current.resetOrderError();
    });

    expect(orderMutation.reset).toHaveBeenCalledTimes(1);
    expect(splitOrderMutation.reset).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('completeRow は intent 付きで完了ミューテーションを呼ぶ', async () => {
    const { result, unmount } = renderHook(() =>
      useProductionScheduleMutations({
        isSearchStateWriting: false,
        noteMaxLength: 100
      })
    );

    await act(async () => {
      await result.current.completeRow('row-z', 'incomplete');
    });

    expect(completeMutation.mutateAsync).toHaveBeenCalledWith({
      rowId: 'row-z',
      intent: 'incomplete'
    });
    unmount();
  });
});
