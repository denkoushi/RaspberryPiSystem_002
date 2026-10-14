import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKioskGrindingPlanningBoardResourceCapacity, useUpdateKioskGrindingPlanningBoardResourceCapacity } from './production-schedule';

import type { GrindingPlanningBoardResourceCapacityResponse } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../client')>(),
  getKioskGrindingPlanningBoardResourceCapacity: mocks.get,
  updateKioskGrindingPlanningBoardResourceCapacity: mocks.put
}));
const key = ['kiosk-planning-board-resource-capacity'];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
describe('planning board resource capacity', () => {
  beforeEach(() => vi.resetAllMocks());
  it('ガント有効時だけ取得し、ボードキャッシュを無効化せず長く保持する', async () => {
    mocks.get.mockResolvedValue({ dailyHoursByResource: { '305': 24 } });
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result, rerender } = renderHook(({ enabled }) => useKioskGrindingPlanningBoardResourceCapacity(enabled), { wrapper, initialProps: { enabled: false } });
    expect(mocks.get).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.data?.dailyHoursByResource['305']).toBe(24));
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
  });
  it('楽観更新後にレスポンス全体を反映する', async () => {
    let finish!: (value: GrindingPlanningBoardResourceCapacityResponse) => void;
    mocks.put.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { client, wrapper } = setup();
    client.setQueryData(key, { dailyHoursByResource: { '584': 10 } });
    const { result } = renderHook(useUpdateKioskGrindingPlanningBoardResourceCapacity, { wrapper });
    act(() => result.current.mutate({ resourceCd: '305', dailyHours: 24 }));
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ dailyHoursByResource: { '584': 10, '305': 24 } }));
    await act(async () => finish({ dailyHoursByResource: { '305': 24, '584': 24 } }));
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ dailyHoursByResource: { '305': 24, '584': 24 } }));
  });
  it.each([true, false])('失敗時は元の設定へ戻す（既存キャッシュ: %s）', async (cached) => {
    let fail!: (error: Error) => void;
    mocks.put.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    const { client, wrapper } = setup();
    const previous = { dailyHoursByResource: cached ? { '305': 10 } : {} };
    if (cached) client.setQueryData(key, previous);
    const { result } = renderHook(useUpdateKioskGrindingPlanningBoardResourceCapacity, { wrapper });
    act(() => result.current.mutate({ resourceCd: '305', dailyHours: 24 }));
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ dailyHoursByResource: { '305': 24 } }));
    await act(async () => fail(new Error('offline')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(key)).toEqual(previous);
  });
});
