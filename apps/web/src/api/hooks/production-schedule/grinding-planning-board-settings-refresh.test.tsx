import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import { useKioskGrindingPlanningBoardResourceCapacity, useUpdateKioskGrindingPlanningBoardResourceCapacity } from './grinding-planning-board';
import { PLANNING_BOARD_SETTINGS_REFETCH_MS, useKioskGrindingPlanningBoardResourceMinutes } from './grinding-planning-board-resource-minutes';

import type { GrindingPlanningBoardResourceCapacityResponse as Capacity } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ minutes: vi.fn(), capacity: vi.fn(), updateCapacity: vi.fn() }));
vi.mock('../../client', () => ({
  getKioskGrindingPlanningBoardResourceMinutes: mocks.minutes,
  getKioskGrindingPlanningBoardResourceCapacity: mocks.capacity,
  updateKioskGrindingPlanningBoardResourceCapacity: mocks.updateCapacity
}));

const capacityKey = productionScheduleQueryKeys.planningBoardResourceCapacityAll;
const capacity = (hours: number): Capacity => ({ dailyHoursByResource: { '305': hours }, runsThroughBreaksResources: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function wrapperFor(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe('planning board settings refresh', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  it('re-reads minutes and capacity while the board stays open', async () => {
    vi.useFakeTimers();
    mocks.minutes.mockResolvedValue({ ownSourceResourceCds: [], values: [] });
    mocks.capacity.mockResolvedValue(capacity(8));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hook = renderHook(() => ({
      minutes: useKioskGrindingPlanningBoardResourceMinutes(true),
      capacity: useKioskGrindingPlanningBoardResourceCapacity(true)
    }), { wrapper: wrapperFor(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocks.minutes).toHaveBeenCalledTimes(1);
    expect(mocks.capacity).toHaveBeenCalledTimes(1);

    mocks.capacity.mockResolvedValue(capacity(10));
    await act(async () => { await vi.advanceTimersByTimeAsync(PLANNING_BOARD_SETTINGS_REFETCH_MS); });

    expect(mocks.minutes).toHaveBeenCalledTimes(2);
    expect(mocks.capacity).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(client.getQueryData(capacityKey)).toEqual(capacity(10));
    hook.unmount();
  });

  it('does not let a fetch that started during a capacity save bring back the older value', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mocks.capacity.mockResolvedValueOnce(capacity(8));
    const hook = renderHook(() => ({
      capacity: useKioskGrindingPlanningBoardResourceCapacity(true),
      update: useUpdateKioskGrindingPlanningBoardResourceCapacity()
    }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(hook.result.current.capacity.data).toEqual(capacity(8)));

    const save = deferred<Capacity>();
    const staleFetch = deferred<Capacity>();
    mocks.updateCapacity.mockReturnValueOnce(save.promise);
    mocks.capacity.mockReturnValueOnce(staleFetch.promise).mockResolvedValue(capacity(9));
    act(() => { hook.result.current.update.mutate({ resourceCd: '305', dailyHours: 9 }); });
    await waitFor(() => expect(mocks.updateCapacity).toHaveBeenCalledTimes(1));
    act(() => { void client.refetchQueries({ queryKey: capacityKey }); });
    await waitFor(() => expect(mocks.capacity).toHaveBeenCalledTimes(2));

    await act(async () => { save.resolve(capacity(9)); await save.promise; });
    await act(async () => { staleFetch.resolve(capacity(8)); await staleFetch.promise; });

    await waitFor(() => expect(mocks.capacity).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(client.isFetching({ queryKey: capacityKey })).toBe(0));
    expect(client.getQueryData(capacityKey)).toEqual(capacity(9));
    hook.unmount();
  });
});
