import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import { useConfigureKioskSessakuPieceOps, useKioskGrindingPlanningBoard, useKioskGrindingPlanningBoardLoad, useKioskGrindingPlanningBoardResourceCapacity, useUpdateKioskGrindingPlanningBoardResourceCapacity } from './grinding-planning-board';
import { PLANNING_BOARD_SETTINGS_REFETCH_MS, useKioskGrindingPlanningBoardResourceMinutes } from './grinding-planning-board-resource-minutes';

import type { GrindingPlanningBoardResourceCapacityRequest, GrindingPlanningBoardResourceCapacityResponse as Capacity } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ minutes: vi.fn(), capacity: vi.fn(), updateCapacity: vi.fn(), board: vi.fn(), load: vi.fn(), configure: vi.fn(), clear: vi.fn() }));
vi.mock('../../client', () => ({
  getKioskGrindingPlanningBoard: mocks.board,
  getKioskGrindingPlanningBoardLoad: mocks.load,
  getKioskGrindingPlanningBoardResourceMinutes: mocks.minutes,
  getKioskGrindingPlanningBoardResourceCapacity: mocks.capacity,
  updateKioskGrindingPlanningBoardResourceCapacity: mocks.updateCapacity
}));

vi.mock('../../domains/production-schedule/grinding-planning-board', () => ({
  configureKioskSessakuPieceOps: mocks.configure, clearKioskSessakuPieceOps: mocks.clear
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

  it.each(['configure', 'clear'] as const)('invalidates the board and part minutes after a %s conflict', async (action) => {
    const error = { isAxiosError: true, response: { status: 409 } };
    mocks[action].mockRejectedValue(error);
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const hook = renderHook(() => useConfigureKioskSessakuPieceOps(), { wrapper: wrapperFor(client) });
    const common = { itemId: 'piece:unit', itemRevision: 'revision', expectedPieceSetVersion: 1 };
    await act(async () => {
      await expect(hook.result.current.mutateAsync(action === 'configure'
        ? { ...common, resourceCd: '021', minutes: [10, 20] } : { ...common, scope: 'piece' })).rejects.toEqual(error);
    });
    expect(mocks[action]).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.planningBoardResourceMinutesAll });
    hook.unmount(); client.clear();
  });

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

  it.each([true, false, null])('immediately refreshes board and load after unit split %s succeeds', async (unitSplitEnabled) => {
    mocks.board.mockResolvedValue({ items: [] }); mocks.load.mockResolvedValue({ resources: [] });
    mocks.updateCapacity.mockResolvedValue({ ...capacity(8), unitSplitEnabledByResource: unitSplitEnabled === null ? {} : { '305': unitSplitEnabled } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(capacityKey, { ...capacity(8), unitSplitEnabledByResource: { '305': !unitSplitEnabled } });
    const hook = renderHook(() => ({
      board: useKioskGrindingPlanningBoard({ category: 'all', view: 'resource' }, { refetchIntervalMs: false }),
      load: useKioskGrindingPlanningBoardLoad('all'),
      update: useUpdateKioskGrindingPlanningBoardResourceCapacity()
    }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(hook.result.current.load.isSuccess && hook.result.current.board.isSuccess).toBe(true));
    await act(async () => { await hook.result.current.update.mutateAsync({ resourceCd: '305', unitSplitEnabled }); });
    await waitFor(() => { expect(mocks.board).toHaveBeenCalledTimes(2); expect(mocks.load).toHaveBeenCalledTimes(2); });
    hook.unmount(); client.clear();
  });

  it.each([
    { payload: { resourceCd: '305', dailyHours: 9 }, callerRefreshes: false },
    { payload: { resourceCd: '305', runsThroughBreaks: true }, callerRefreshes: false },
    { payload: { resourceCd: '305', unitSplitEnabled: true }, callerRefreshes: true }
  ] satisfies { payload: GrindingPlanningBoardResourceCapacityRequest; callerRefreshes: boolean }[])('leaves refresh to the caller for $payload / $callerRefreshes', async ({ payload, callerRefreshes }) => {
    mocks.board.mockResolvedValue({ items: [] }); mocks.load.mockResolvedValue({ resources: [] });
    mocks.updateCapacity.mockResolvedValue(capacity(9));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hook = renderHook(() => ({
      board: useKioskGrindingPlanningBoard({ category: 'all', view: 'resource' }, { refetchIntervalMs: false }),
      load: useKioskGrindingPlanningBoardLoad('all'),
      update: useUpdateKioskGrindingPlanningBoardResourceCapacity({ invalidateOnSuccess: !callerRefreshes })
    }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(hook.result.current.load.isSuccess && hook.result.current.board.isSuccess).toBe(true));
    await act(async () => { await hook.result.current.update.mutateAsync(payload); });
    expect(mocks.board).toHaveBeenCalledTimes(1); expect(mocks.load).toHaveBeenCalledTimes(1);
    hook.unmount(); client.clear();
  });

  it('restores the setting without refreshing board or load when unit split fails', async () => {
    mocks.board.mockResolvedValue({ items: [] }); mocks.load.mockResolvedValue({ resources: [] });
    mocks.updateCapacity.mockRejectedValue(new Error('save failed'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const previous = { ...capacity(8), unitSplitEnabledByResource: { '305': false } };
    client.setQueryData(capacityKey, previous);
    const hook = renderHook(() => ({
      board: useKioskGrindingPlanningBoard({ category: 'all', view: 'resource' }, { refetchIntervalMs: false }),
      load: useKioskGrindingPlanningBoardLoad('all'),
      update: useUpdateKioskGrindingPlanningBoardResourceCapacity()
    }), { wrapper: wrapperFor(client) });
    await waitFor(() => expect(hook.result.current.load.isSuccess && hook.result.current.board.isSuccess).toBe(true));
    await act(async () => { await expect(hook.result.current.update.mutateAsync({ resourceCd: '305', unitSplitEnabled: true })).rejects.toThrow('save failed'); });
    expect(client.getQueryData(capacityKey)).toEqual(previous);
    expect(mocks.board).toHaveBeenCalledTimes(1); expect(mocks.load).toHaveBeenCalledTimes(1);
    hook.unmount(); client.clear();
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
