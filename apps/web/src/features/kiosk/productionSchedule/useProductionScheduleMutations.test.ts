import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useProductionScheduleMutations } from './useProductionScheduleMutations';

const completeMutation = {
  isPending: false,
  mutateAsync: vi.fn(async (_rowId: string) => undefined)
};
const orderMutation = {
  isPending: false,
  mutate: vi.fn()
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

vi.mock('../../../api/hooks', () => ({
  useCompleteKioskProductionScheduleRow: () => completeMutation,
  useUpdateKioskProductionScheduleOrder: () => orderMutation,
  useUpdateKioskProductionScheduleProcessing: () => processingMutation,
  useUpdateKioskProductionScheduleNote: () => noteMutation,
  useUpdateKioskProductionScheduleDueDate: () => dueDateMutation
}));

describe('useProductionScheduleMutations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    completeMutation.isPending = false;
    orderMutation.isPending = false;
    processingMutation.isPending = false;
    noteMutation.isPending = false;
    dueDateMutation.isPending = false;
    completeMutation.mutateAsync.mockClear();
    orderMutation.mutate.mockClear();
    processingMutation.mutate.mockClear();
    noteMutation.mutate.mockClear();
    dueDateMutation.mutate.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('書き込み終了後に pauseRefetch のクールダウンを維持する', () => {
    const { result, rerender } = renderHook(
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
  });

  it('saveNote で改行除去・trim・最大長制限を適用する', () => {
    const { result } = renderHook(() =>
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
      { onSettled }
    );
  });

  it('updateOrder で空文字を null に変換する', () => {
    const { result } = renderHook(() =>
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

    expect(orderMutation.mutate).toHaveBeenCalledWith({
      rowId: 'row-1',
      payload: {
        resourceCd: 'R01',
        orderNumber: null
      }
    });
  });
});
