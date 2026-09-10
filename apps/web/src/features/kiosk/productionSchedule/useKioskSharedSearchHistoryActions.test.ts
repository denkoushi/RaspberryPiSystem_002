import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKioskSharedSearchHistoryActions } from './useKioskSharedSearchHistoryActions';

const searchStateQuery = {
  data: undefined as { etag: string; state: { history: string[] } } | undefined,
  refetch: vi.fn()
};
const updateMutation = {
  isPending: false,
  mutateAsync: vi.fn()
};

vi.mock('../../../api/hooks', () => ({
  useKioskProductionScheduleSearchState: () => searchStateQuery,
  useUpdateKioskProductionScheduleSearchState: () => updateMutation
}));

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'QueryClientTestWrapper';
  return Wrapper;
};

describe('useKioskSharedSearchHistoryActions', () => {
  beforeEach(() => {
    searchStateQuery.data = undefined;
    searchStateQuery.refetch.mockReset();
    updateMutation.mutateAsync.mockReset();
  });

  it('保存成功後の invalidate 完了を待たずに履歴保存を完了する', async () => {
    const queryClient = new QueryClient();
    let resolveInvalidation!: () => void;
    const invalidation = new Promise<void>((resolve) => {
      resolveInvalidation = resolve;
    });
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(invalidation);
    const fresh = { etag: 'etag-1', state: { history: ['A'] } };
    searchStateQuery.refetch.mockResolvedValue({ data: fresh });
    updateMutation.mutateAsync.mockResolvedValue({
      etag: 'etag-2',
      state: { history: ['B', 'A'] },
      updatedAt: '2026-09-10T00:00:00.000Z'
    });

    const { result } = renderHook(() => useKioskSharedSearchHistoryActions(), {
      wrapper: createWrapper(queryClient)
    });

    await act(async () => {
      await result.current.addSeibanToHistory('B');
    });

    expect(updateMutation.mutateAsync).toHaveBeenCalledWith({
      state: { history: ['B', 'A'] },
      ifMatch: 'etag-1'
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: ['kiosk-production-schedule-search-state']
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: ['kiosk-production-schedule-progress-overview']
    });

    resolveInvalidation();
    await invalidation;
  });

  it('保存失敗時は invalidate を開始せず呼出側へエラーを返す', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const saveError = new Error('save failed');
    const fresh = { etag: 'etag-1', state: { history: ['A'] } };
    searchStateQuery.refetch.mockResolvedValue({ data: fresh });
    updateMutation.mutateAsync.mockRejectedValue(saveError);

    const { result } = renderHook(() => useKioskSharedSearchHistoryActions(), {
      wrapper: createWrapper(queryClient)
    });

    await act(async () => {
      await expect(result.current.addSeibanToHistory('B')).rejects.toBe(saveError);
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('背景 invalidate の失敗で保存成功を失敗扱いにしない', async () => {
    const queryClient = new QueryClient();
    const invalidationError = new Error('refresh failed');
    vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValue(invalidationError);
    const fresh = { etag: 'etag-1', state: { history: ['A'] } };
    searchStateQuery.refetch.mockResolvedValue({ data: fresh });
    updateMutation.mutateAsync.mockResolvedValue({
      etag: 'etag-2',
      state: { history: ['B', 'A'] },
      updatedAt: '2026-09-10T00:00:00.000Z'
    });

    const { result } = renderHook(() => useKioskSharedSearchHistoryActions(), {
      wrapper: createWrapper(queryClient)
    });

    await act(async () => {
      await result.current.addSeibanToHistory('B');
      await Promise.resolve();
    });

    expect(updateMutation.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('背景 invalidate 中の連続追加でも refetch した最新 ETag で保存する', async () => {
    const queryClient = new QueryClient();
    const invalidation = new Promise<void>(() => {});
    vi.spyOn(queryClient, 'invalidateQueries').mockReturnValue(invalidation);
    let current = { etag: 'etag-1', state: { history: [] as string[] } };
    searchStateQuery.refetch.mockImplementation(async () => ({
      data: {
        etag: current.etag,
        state: { history: [...current.state.history] }
      }
    }));
    updateMutation.mutateAsync.mockImplementation(async ({ state, ifMatch }) => {
      const nextEtag = ifMatch === 'etag-1' ? 'etag-2' : 'etag-3';
      current = { etag: nextEtag, state: { history: [...state.history] } };
      return { ...current, updatedAt: '2026-09-10T00:00:00.000Z' };
    });

    const { result } = renderHook(() => useKioskSharedSearchHistoryActions(), {
      wrapper: createWrapper(queryClient)
    });

    await act(async () => {
      await result.current.addSeibanToHistory('A');
      await result.current.addSeibanToHistory('B');
    });

    expect(updateMutation.mutateAsync).toHaveBeenNthCalledWith(1, {
      state: { history: ['A'] },
      ifMatch: 'etag-1'
    });
    expect(updateMutation.mutateAsync).toHaveBeenNthCalledWith(2, {
      state: { history: ['B', 'A'] },
      ifMatch: 'etag-2'
    });
    expect(current).toEqual({ etag: 'etag-3', state: { history: ['B', 'A'] } });
  });
});
