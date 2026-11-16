import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productionScheduleQueryKeys } from '../../queryKeys/productionSchedule';

import { useKioskGrindingPlanningBoard, useKioskGrindingPlanningBoardLoad, useKioskGrindingPlanningBoardResourceCapacity } from './grinding-planning-board';
import { useConfigureKioskSessakuPieceOps, useUpdateKioskGrindingPlanningBoardResourceCapacity } from './grinding-planning-board-mutations';
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

  const configurePayload = { itemId: 'piece:unit', itemRevision: 'revision', expectedPieceSetVersion: 1,
    resourceCd: '021', minutes: [10, 20] };
  const secondaryKeys = [
    productionScheduleQueryKeys.grindingPlanningBoardLoad('all'),
    productionScheduleQueryKeys.grindingPlanningBoardProcessChips([]),
    productionScheduleQueryKeys.grindingPlanningBoardSnapshot({ category: 'all', view: 'resource' }),
    productionScheduleQueryKeys.planningBoardResourceMinutesAll,
    productionScheduleQueryKeys.scheduleAll, productionScheduleQueryKeys.orderUsageAll,
    productionScheduleQueryKeys.historyProgressAll, productionScheduleQueryKeys.grindingPlanningBoardDueDetail('26-1')
  ];

  it.each(['mounted', 'category changed', 'unmounted', 'board failed'] as const)(
    'refreshes only board first, then every secondary once without waiting (%s)', async (transition) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      const save = deferred<object>(); const board = deferred<unknown>(); const secondary = deferred<object>();
      mocks.configure.mockReturnValueOnce(save.promise);
      const reads = secondaryKeys.map(() => vi.fn().mockResolvedValue({}));
      const refreshBoard = vi.fn(() => board.promise);
      const changedScopeRefresh = vi.fn().mockResolvedValue({});
      // Active consumers make invalidation counts observable as actual GET counts.
      const consumers = renderHook(() => secondaryKeys.map((queryKey, i) => useQuery({ queryKey, queryFn: reads[i] })),
        { wrapper: wrapperFor(client) });
      await waitFor(() => expect(reads.every((read) => read.mock.calls.length === 1)).toBe(true));
      reads.forEach((read) => read.mockReturnValue(secondary.promise));
      const hook = renderHook(({ changed }) => useConfigureKioskSessakuPieceOps('scaw', {
        refreshBoard: changed ? changedScopeRefresh : refreshBoard
      }), { initialProps: { changed: false }, wrapper: wrapperFor(client) });
      let settled = false; let mutation!: Promise<unknown>;
      act(() => { mutation = hook.result.current.mutateAsync(configurePayload).finally(() => { settled = true; }); });
      await waitFor(() => expect(mocks.configure).toHaveBeenCalledWith({ ...configurePayload, dueSource: 'scaw' }));
      expect(refreshBoard).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled();
      if (transition === 'category changed') hook.rerender({ changed: true });
      if (transition === 'unmounted') hook.unmount();
      await act(async () => { save.resolve({}); });
      await waitFor(() => expect(refreshBoard).toHaveBeenCalledTimes(1));
      expect(changedScopeRefresh).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      reads.forEach((read) => expect(read).toHaveBeenCalledTimes(1));
      expect(invalidate).toHaveBeenCalledExactlyOnceWith({
        queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll, refetchType: 'none'
      });
      await act(async () => { board.resolve(transition === 'board failed' ? { isError: true } : { isError: false }); await mutation; });
      expect(settled).toBe(true);
      await waitFor(() => reads.forEach((read) => expect(read).toHaveBeenCalledTimes(2)));
      expect(client.isFetching()).toBe(secondaryKeys.length);
      expect(invalidate).toHaveBeenCalledTimes(7);
      await act(async () => { secondary.resolve({}); });
      if (transition !== 'unmounted') hook.unmount();
      consumers.unmount(); client.clear();
    });

  it.each(['configure', 'clear'] as const)('preserves the default %s refresh and wait behavior', async (action) => {
    mocks[action].mockResolvedValueOnce({});
    const client = new QueryClient(); const fetch = deferred<void>();
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockReturnValue(fetch.promise);
    const refreshBoard = vi.fn();
    const hook = renderHook(() => useConfigureKioskSessakuPieceOps(undefined, action === 'clear' ? { refreshBoard } : undefined),
      { wrapper: wrapperFor(client) });
    let settled = false; let mutation!: Promise<unknown>;
    act(() => { mutation = hook.result.current.mutateAsync(action === 'configure' ? configurePayload : {
      itemId: 'piece:unit', itemRevision: 'revision', expectedPieceSetVersion: 1, scope: 'piece'
    }).then(() => { settled = true; }); });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(5));
    expect(settled).toBe(false); expect(refreshBoard).not.toHaveBeenCalled();
    await act(async () => { fetch.resolve(); await mutation; });
    expect(settled).toBe(true); hook.unmount(); client.clear();
  });

  it.each([409, 500])('preserves configure failure invalidations for status %s', async (status) => {
    const error = { isAxiosError: true, response: { status } };
    mocks.configure.mockRejectedValueOnce(error);
    const client = new QueryClient(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    const refreshBoard = vi.fn();
    const hook = renderHook(() => useConfigureKioskSessakuPieceOps(undefined, { refreshBoard }), { wrapper: wrapperFor(client) });
    await act(async () => { await expect(hook.result.current.mutateAsync(configurePayload)).rejects.toEqual(error); });
    expect(refreshBoard).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(status === 409 ? 2 : 0);
    if (status === 409) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.grindingPlanningBoardAll });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: productionScheduleQueryKeys.planningBoardResourceMinutesAll });
    }
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
