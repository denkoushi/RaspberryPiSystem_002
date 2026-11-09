import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useKioskGrindingPlanningBoardResourceMinutes, useUpdateKioskGrindingPlanningBoardResourceMinutesSource, useUpdateKioskGrindingPlanningBoardResourcePartMinutes } from './production-schedule';

import type { GrindingPlanningBoardResourceMinutesResponse as Settings } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), source: vi.fn(), value: vi.fn() }));
vi.mock('../client', async (original) => ({ ...await original<typeof import('../client')>(),
  getKioskGrindingPlanningBoardResourceMinutes: mocks.get,
  updateKioskGrindingPlanningBoardResourceMinutesSource: mocks.source,
  updateKioskGrindingPlanningBoardResourcePartMinutes: mocks.value
}));
const key = ['kiosk-planning-board-resource-minutes'];
const initial: Settings = { ownSourceResourceCds: ['584'], values: [{ resourceCd: '305', fhincd: 'P1', perUnitMinutes: 10, setupMinutes: 30 }] };
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(key, initial);
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
describe('resource minutes hooks', () => {
  beforeEach(() => vi.resetAllMocks());
  it('fetches only when enabled and keeps settings cached', async () => {
    const { client, wrapper } = setup(); client.removeQueries({ queryKey: key });
    mocks.get.mockResolvedValue(initial);
    const { result, rerender } = renderHook(({ enabled }) => useKioskGrindingPlanningBoardResourceMinutes(enabled), { wrapper, initialProps: { enabled: false } });
    expect(mocks.get).not.toHaveBeenCalled(); rerender({ enabled: true });
    await waitFor(() => expect(result.current.data).toEqual(initial));
    rerender({ enabled: false }); rerender({ enabled: true }); expect(mocks.get).toHaveBeenCalledTimes(1);
  });
  it.each(['original', 'own'] as const)('optimistically selects %s, rolls back on failure', async (source) => {
    const { client, wrapper } = setup();
    let reject!: (error: Error) => void;
    mocks.source.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const { result } = renderHook(useUpdateKioskGrindingPlanningBoardResourceMinutesSource, { wrapper });
    act(() => result.current.mutate({ resourceCd: '584', source }));
    await waitFor(() => expect((client.getQueryData(key) as Settings).ownSourceResourceCds).toEqual(source === 'own' ? ['584'] : []));
    await waitFor(() => expect(mocks.source).toHaveBeenCalled());
    await act(async () => reject(new Error('offline')));
    await waitFor(() => expect(result.current.isError).toBe(true)); expect(client.getQueryData(key)).toEqual(initial);
  });
  it.each([null, 0, 12.5])('updates/clears %s immediately, invalidates board and load on success', async (perUnitMinutes) => {
    const { client, wrapper } = setup(); const invalidate = vi.spyOn(client, 'invalidateQueries');
    let resolve!: (value: Settings) => void;
    mocks.value.mockReturnValue(new Promise((done) => { resolve = done; }));
    const { result } = renderHook(() => useUpdateKioskGrindingPlanningBoardResourcePartMinutes('305', 'P1'), { wrapper });
    const payload = { resourceCd: '305', fhincd: 'P1', perUnitMinutes, setupMinutes: 5 };
    const next = { ...initial, values: perUnitMinutes === null ? [] : [{ ...payload, perUnitMinutes }] };
    act(() => result.current.mutate(payload));
    await waitFor(() => expect(client.getQueryData(key)).toEqual(next));
    await act(async () => resolve(next));
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['kiosk-grinding-planning-board'] }));
    expect(client.getQueryData(key)).toEqual(next);
  });
  it.each([400, 409])('refreshes resource minutes after a %s failure and permits a corrected retry', async (status) => {
    const { client, wrapper } = setup();
    const refreshed = { ...initial, values: [{ ...initial.values[0]!, perUnitMinutes: 20 }] };
    mocks.get.mockResolvedValue(refreshed);
    mocks.value.mockRejectedValueOnce({ isAxiosError: true, response: { status } }).mockResolvedValue(refreshed);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => ({
      query: useKioskGrindingPlanningBoardResourceMinutes(true),
      mutation: useUpdateKioskGrindingPlanningBoardResourcePartMinutes('305', 'P1')
    }), { wrapper });
    act(() => result.current.mutation.mutate({ ...initial.values[0]!, perUnitMinutes: 12 }));
    await waitFor(() => expect(result.current.mutation.isError).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    await waitFor(() => expect(result.current.query.data).toEqual(refreshed));
    act(() => result.current.mutation.mutate(refreshed.values[0]!));
    await waitFor(() => expect(result.current.mutation.isSuccess).toBe(true));
  });
  it('prevents an older failure refetch from overwriting another row saved meanwhile', async () => {
    const { client, wrapper } = setup();
    const other = { resourceCd: '305', fhincd: 'P2', perUnitMinutes: 2, setupMinutes: 0 };
    const before: Settings = { ...initial, values: [...initial.values, other] };
    const updated = { ...other, perUnitMinutes: 12 };
    const after: Settings = { ...initial, values: [...initial.values, updated] };
    client.setQueryData(key, before);
    let failA!: (error: unknown) => void;
    let finishB!: (value: Settings) => void;
    let finishOldGet!: (value: Settings) => void;
    let finishNewGet!: (value: Settings) => void;
    mocks.value.mockReturnValueOnce(new Promise((_resolve, reject) => { failA = reject; }))
      .mockReturnValueOnce(new Promise<Settings>((resolve) => { finishB = resolve; }));
    mocks.get.mockReturnValueOnce(new Promise<Settings>((resolve) => { finishOldGet = resolve; }))
      .mockReturnValueOnce(new Promise<Settings>((resolve) => { finishNewGet = resolve; }));
    const { result } = renderHook(() => ({
      query: useKioskGrindingPlanningBoardResourceMinutes(true),
      a: useUpdateKioskGrindingPlanningBoardResourcePartMinutes('305', 'P1'),
      b: useUpdateKioskGrindingPlanningBoardResourcePartMinutes('305', 'P2')
    }), { wrapper });
    act(() => {
      result.current.a.mutate({ ...initial.values[0]!, perUnitMinutes: 20 });
      result.current.b.mutate(updated);
    });
    await waitFor(() => expect(mocks.value).toHaveBeenCalledTimes(2));
    await act(async () => failA({ isAxiosError: true, response: { status: 400 } }));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    await act(async () => finishB(after));
    await waitFor(() => expect(result.current.b.isSuccess).toBe(true));
    expect(client.getQueryData(key)).toEqual(after);
    await act(async () => finishOldGet(before));
    expect(client.getQueryData(key)).toEqual(after);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    await act(async () => finishNewGet(after));
    await waitFor(() => expect(result.current.query.isFetching).toBe(false));
    expect(result.current.query.data).toEqual(after);
  });
  it('restarts a conflict refetch cancelled by a later save on another row', async () => {
    const { client, wrapper } = setup();
    const other = { resourceCd: '305', fhincd: 'P2', perUnitMinutes: 2, setupMinutes: 0 };
    const before: Settings = { ...initial, values: [...initial.values, other] };
    const updated = { ...other, perUnitMinutes: 12 };
    const changed = { ...initial.values[0]!, ops: [{ opNo: 3, minutes: 10, setupMinutes: 30 }] };
    const after: Settings = { ...initial, values: [changed, updated] };
    client.setQueryData(key, before);
    let finishB!: (value: Settings) => void;
    let finishOldGet!: (value: Settings) => void;
    let finishNewGet!: (value: Settings) => void;
    mocks.value.mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } })
      .mockReturnValueOnce(new Promise<Settings>((resolve) => { finishB = resolve; }));
    mocks.get.mockReturnValueOnce(new Promise<Settings>((resolve) => { finishOldGet = resolve; }))
      .mockReturnValueOnce(new Promise<Settings>((resolve) => { finishNewGet = resolve; }));
    const { result } = renderHook(() => ({
      query: useKioskGrindingPlanningBoardResourceMinutes(true),
      a: useUpdateKioskGrindingPlanningBoardResourcePartMinutes('305', 'P1'),
      b: useUpdateKioskGrindingPlanningBoardResourcePartMinutes('305', 'P2')
    }), { wrapper });
    act(() => result.current.a.mutate({ ...initial.values[0]!, perUnitMinutes: 20 }));
    await waitFor(() => expect(result.current.a.isError).toBe(true));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(1));
    act(() => result.current.b.mutate(updated));
    await waitFor(() => expect(mocks.value).toHaveBeenCalledTimes(2));
    expect(client.isFetching({ queryKey: key })).toBe(0);
    await act(async () => finishB({ ...initial, values: [...initial.values, updated] }));
    await waitFor(() => expect(result.current.b.isSuccess).toBe(true));
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    await act(async () => finishOldGet(before));
    expect((client.getQueryData(key) as Settings).values).toContainEqual(updated);
    await act(async () => finishNewGet(after));
    await waitFor(() => expect(result.current.query.data).toEqual(after));
    expect(result.current.query.isFetching).toBe(false);
  });
  it('rolls back only the failed row, preserving another row edit', async () => {
    const { client, wrapper } = setup(); let reject!: (error: Error) => void;
    mocks.value.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const { result } = renderHook(() => useUpdateKioskGrindingPlanningBoardResourcePartMinutes('305', 'P1'), { wrapper });
    act(() => result.current.mutate({ resourceCd: '305', fhincd: 'P1', perUnitMinutes: null, setupMinutes: 0 }));
    await waitFor(() => expect((client.getQueryData(key) as Settings).values).toEqual([]));
    const other = { resourceCd: '305', fhincd: 'P2', perUnitMinutes: 2, setupMinutes: 0 };
    client.setQueryData(key, { ...initial, values: [other] });
    await act(async () => reject(new Error('offline')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((client.getQueryData(key) as Settings).values).toEqual([other, ...initial.values]);
  });
});
