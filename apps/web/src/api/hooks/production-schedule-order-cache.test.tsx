import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  useUpdateKioskProductionScheduleOrder,
  useUpdateKioskProductionScheduleSplitOrder
} from './production-schedule';

import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  updateOrder: vi.fn(),
  updateSplitOrder: vi.fn()
}));

vi.mock('../../api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/client')>();
  return {
    ...original,
    updateKioskProductionScheduleOrder: mocks.updateOrder,
    updateKioskProductionScheduleSplitOrder: mocks.updateSplitOrder
  };
});

const scheduleKey = ['kiosk-production-schedule', { resourceCds: 'R1' }] as const;
const usageKey = ['kiosk-production-schedule-order-usage', 'R1', undefined] as const;
type ScheduleCache = { rows: Array<{ processingOrder: number | null }> };

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  });
}

function wrapper(client: QueryClient) {
  return function QueryClientWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

function seedCache(client: QueryClient) {
  client.setQueryData(scheduleKey, {
    page: 1,
    pageSize: 100,
    total: 1,
    rows: [
      {
        id: 'row-1',
        occurredAt: '',
        rowData: { FSIGENCD: 'R1' },
        processingOrder: 2
      }
    ]
  });
  client.setQueryData(usageKey, { R1: [2] });
}

describe('useUpdateKioskProductionScheduleOrder manual-order optimistic policy', () => {
  beforeEach(() => {
    mocks.updateOrder.mockReset();
    mocks.updateSplitOrder.mockReset();
  });

  it('patches while saving, keeps the server correction, and revalidates related queries', async () => {
    let resolveRequest: ((value: { success: true; orderNumber: number | null }) => void) | undefined;
    mocks.updateOrder.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const client = createClient();
    seedCache(client);
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries').mockImplementation(
      () => new Promise<void>(() => {})
    );
    const result = renderHook(() => useUpdateKioskProductionScheduleOrder(), {
      wrapper: wrapper(client)
    });

    act(() => {
      result.result.current.mutate({
        rowId: 'row-1',
        payload: { resourceCd: 'R1', orderNumber: 1 },
        cachePolicy: 'manualOrderOptimistic'
      });
    });

    await waitFor(() => {
      expect(client.getQueryData<ScheduleCache>(scheduleKey)?.rows[0]?.processingOrder).toBe(1);
      expect(client.getQueryData<Record<string, number[]>>(usageKey)?.R1).toEqual([1]);
      expect(result.result.current.isPending).toBe(true);
    });

    await act(async () => {
      resolveRequest?.({ success: true, orderNumber: 7 });
    });

    await waitFor(() => expect(result.result.current.isSuccess).toBe(true));
    expect(client.getQueryData<ScheduleCache>(scheduleKey)?.rows[0]?.processingOrder).toBe(7);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['kiosk-production-schedule'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['kiosk-production-schedule-order-usage'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['kiosk-production-schedule-due-management-manual-order-overview']
    });
  });

  it('rolls back the optimistic patch when saving fails', async () => {
    mocks.updateOrder.mockRejectedValue(new Error('save failed'));
    const client = createClient();
    seedCache(client);
    const result = renderHook(() => useUpdateKioskProductionScheduleOrder(), {
      wrapper: wrapper(client)
    });

    const mutationPromise = result.result.current.mutateAsync({
      rowId: 'row-1',
      payload: { resourceCd: 'R1', orderNumber: 1 },
      cachePolicy: 'manualOrderOptimistic'
    });

    await expect(mutationPromise).rejects.toThrow('save failed');
    expect(mocks.updateOrder).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<ScheduleCache>(scheduleKey)?.rows[0]?.processingOrder).toBe(2);
    expect(client.getQueryData<Record<string, number[]>>(usageKey)?.R1).toEqual([2]);
  });

  it('scopes manual-order optimistic patches to the matching target device cache', async () => {
    const targetScheduleKey = [
      'kiosk-production-schedule',
      { resourceCds: 'R1', targetDeviceScopeKey: 'device-a' }
    ] as const;
    const otherScheduleKey = [
      'kiosk-production-schedule',
      { resourceCds: 'R1', targetDeviceScopeKey: 'device-b' }
    ] as const;
    const targetUsageKey = ['kiosk-production-schedule-order-usage', 'R1', 'device-a'] as const;
    const otherUsageKey = ['kiosk-production-schedule-order-usage', 'R1', 'device-b'] as const;
    const cache = {
      page: 1,
      pageSize: 100,
      total: 1,
      rows: [
        {
          id: 'row-1',
          occurredAt: '',
          rowData: { FSIGENCD: 'R1' },
          processingOrder: 2
        }
      ]
    };
    const client = createClient();
    client.setQueryData(targetScheduleKey, cache);
    client.setQueryData(otherScheduleKey, { ...cache, rows: [{ ...cache.rows[0], processingOrder: 9 }] });
    client.setQueryData(targetUsageKey, { R1: [2] });
    client.setQueryData(otherUsageKey, { R1: [9] });
    mocks.updateOrder.mockResolvedValue({ success: true, orderNumber: 1 });

    const result = renderHook(() => useUpdateKioskProductionScheduleOrder(), {
      wrapper: wrapper(client)
    });

    act(() => {
      result.result.current.mutate({
        rowId: 'row-1',
        payload: { resourceCd: 'R1', orderNumber: 1, targetDeviceScopeKey: 'device-a' },
        cachePolicy: 'manualOrderOptimistic'
      });
    });

    await waitFor(() => expect(result.result.current.isSuccess).toBe(true));
    expect(client.getQueryData<ScheduleCache>(targetScheduleKey)?.rows[0]?.processingOrder).toBe(1);
    expect(client.getQueryData<ScheduleCache>(otherScheduleKey)?.rows[0]?.processingOrder).toBe(9);
    expect(client.getQueryData<Record<string, number[]>>(targetUsageKey)?.R1).toEqual([1]);
    expect(client.getQueryData<Record<string, number[]>>(otherUsageKey)?.R1).toEqual([9]);
  });
});

describe('useUpdateKioskProductionScheduleSplitOrder manual-order optimistic policy', () => {
  const targetScheduleKey = [
    'kiosk-production-schedule',
    { resourceCds: 'R1', targetDeviceScopeKey: 'device-a' }
  ] as const;
  const otherScheduleKey = [
    'kiosk-production-schedule',
    { resourceCds: 'R1', targetDeviceScopeKey: 'device-b' }
  ] as const;
  const targetUsageKey = ['kiosk-production-schedule-order-usage', 'R1', 'device-a'] as const;
  const otherUsageKey = ['kiosk-production-schedule-order-usage', 'R1', 'device-b'] as const;

  function seedSplitCache(client: QueryClient) {
    const cache = {
      page: 1,
      pageSize: 100,
      total: 1,
      rows: [
        {
          id: 'split:split-1',
          occurredAt: '',
          rowData: { FSIGENCD: 'R1' },
          processingOrder: 2
        }
      ]
    };
    client.setQueryData(targetScheduleKey, cache);
    client.setQueryData(otherScheduleKey, {
      ...cache,
      rows: [{ ...cache.rows[0], processingOrder: 9 }]
    });
    client.setQueryData(targetUsageKey, { R1: [2] });
    client.setQueryData(otherUsageKey, { R1: [9] });
  }

  it('split行を対象scopeだけ即時更新し、サーバー補正を反映する', async () => {
    let resolveRequest: ((value: { success: true; orderNumber: number | null }) => void) | undefined;
    mocks.updateSplitOrder.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );

    const client = createClient();
    seedSplitCache(client);
    const result = renderHook(() => useUpdateKioskProductionScheduleSplitOrder(), {
      wrapper: wrapper(client)
    });

    act(() => {
      result.result.current.mutate({
        splitId: 'split-1',
        payload: { resourceCd: 'R1', orderNumber: 1, targetDeviceScopeKey: 'device-a' },
        cachePolicy: 'manualOrderOptimistic'
      });
    });

    await waitFor(() => {
      expect(client.getQueryData<ScheduleCache>(targetScheduleKey)?.rows[0]?.processingOrder).toBe(1);
      expect(client.getQueryData<ScheduleCache>(otherScheduleKey)?.rows[0]?.processingOrder).toBe(9);
      expect(client.getQueryData<Record<string, number[]>>(targetUsageKey)?.R1).toEqual([1]);
      expect(client.getQueryData<Record<string, number[]>>(otherUsageKey)?.R1).toEqual([9]);
      expect(result.result.current.isPending).toBe(true);
    });

    await act(async () => {
      resolveRequest?.({ success: true, orderNumber: 7 });
    });

    await waitFor(() => {
      expect(result.result.current.isSuccess).toBe(true);
      expect(client.getQueryData<ScheduleCache>(targetScheduleKey)?.rows[0]?.processingOrder).toBe(7);
      expect(client.getQueryData<ScheduleCache>(otherScheduleKey)?.rows[0]?.processingOrder).toBe(9);
    });
  });

  it('split行の保存失敗時は一覧とusageをロールバックする', async () => {
    mocks.updateSplitOrder.mockRejectedValue(new Error('save failed'));
    const client = createClient();
    seedSplitCache(client);
    const result = renderHook(() => useUpdateKioskProductionScheduleSplitOrder(), {
      wrapper: wrapper(client)
    });

    const mutationPromise = result.result.current.mutateAsync({
      splitId: 'split-1',
      payload: { resourceCd: 'R1', orderNumber: 1, targetDeviceScopeKey: 'device-a' },
      cachePolicy: 'manualOrderOptimistic'
    });

    await expect(mutationPromise).rejects.toThrow('save failed');
    expect(client.getQueryData<ScheduleCache>(targetScheduleKey)?.rows[0]?.processingOrder).toBe(2);
    expect(client.getQueryData<Record<string, number[]>>(targetUsageKey)?.R1).toEqual([2]);
    expect(client.getQueryData<ScheduleCache>(otherScheduleKey)?.rows[0]?.processingOrder).toBe(9);
  });
});
