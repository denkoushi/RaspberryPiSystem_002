import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { productionFixture } from '../../features/kiosk/grindingPlanningBoard/__perf__/fixture';
import { PlanningBoardGanttDisplay } from '../../features/kiosk/grindingPlanningBoard/gantt/PlanningBoardGanttDisplay';
import { buildPlanningBoardGanttLayout } from '../../features/kiosk/grindingPlanningBoard/gantt/planningBoardGanttLayout';

import { useKioskGrindingPlanningBoardResourceCapacity, useUpdateKioskGrindingPlanningBoardResourceCapacity } from './production-schedule';

import type { GrindingPlanningBoardResourceCapacityResponse } from '@raspi-system/shared-types';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../client')>(),
  getKioskGrindingPlanningBoardResourceCapacity: mocks.get,
  updateKioskGrindingPlanningBoardResourceCapacity: mocks.put
}));
vi.mock('./machine-signal', () => ({ useMachineSignalResourceUptime: () => ({ data: undefined }) }));
const key = ['kiosk-planning-board-resource-capacity'];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
describe('planning board resource capacity', () => {
  beforeEach(() => vi.resetAllMocks());
  it('ガント有効時だけ取得し、ボードキャッシュを無効化せず長く保持する', async () => {
    mocks.get.mockResolvedValue({ runsThroughBreaksResources: [], dailyHoursByResource: { '305': 24 } });
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
    client.setQueryData(key, { runsThroughBreaksResources: ['584'], dailyHoursByResource: { '584': 10 } });
    const { result } = renderHook(useUpdateKioskGrindingPlanningBoardResourceCapacity, { wrapper });
    act(() => result.current.mutate({ resourceCd: '305', dailyHours: 24 }));
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ runsThroughBreaksResources: ['584'], dailyHoursByResource: { '584': 10, '305': 24 } }));
    await act(async () => finish({ runsThroughBreaksResources: [], dailyHoursByResource: { '305': 24, '584': 24 } }));
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ runsThroughBreaksResources: [], dailyHoursByResource: { '305': 24, '584': 24 } }));
  });
  it.each([true, false])('optimistically changes only breaks and preserves hours (%s)', async (runsThroughBreaks) => {
    let finish!: (value: GrindingPlanningBoardResourceCapacityResponse) => void;
    mocks.put.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { client, wrapper } = setup();
    client.setQueryData(key, { dailyHoursByResource: { '305': 10 }, runsThroughBreaksResources: ['584', ...(!runsThroughBreaks ? ['305'] : [])] });
    const { result } = renderHook(useUpdateKioskGrindingPlanningBoardResourceCapacity, { wrapper });
    act(() => result.current.mutate({ resourceCd: '305', runsThroughBreaks }));
    const expected = { dailyHoursByResource: { '305': 10 as const }, runsThroughBreaksResources: ['584', ...(runsThroughBreaks ? ['305'] : [])] };
    await waitFor(() => expect(client.getQueryData(key)).toEqual(expected));
    await act(async () => finish(expected));
    expect(mocks.put).toHaveBeenCalledWith({ resourceCd: '305', runsThroughBreaks });
  });
  it.each([true, false])('失敗時は元の設定へ戻す（既存キャッシュ: %s）', async (cached) => {
    let fail!: (error: Error) => void;
    mocks.put.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    const { client, wrapper } = setup();
    const previous = { runsThroughBreaksResources: [], dailyHoursByResource: cached ? { '305': 10 } : {} };
    if (cached) client.setQueryData(key, previous);
    const { result } = renderHook(useUpdateKioskGrindingPlanningBoardResourceCapacity, { wrapper });
    act(() => result.current.mutate({ resourceCd: '305', dailyHours: 24 }));
    await waitFor(() => expect(client.getQueryData(key)).toEqual({ runsThroughBreaksResources: [], dailyHoursByResource: { '305': 24 } }));
    await act(async () => fail(new Error('offline')));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(client.getQueryData(key)).toEqual(previous);
  });
});


it.each([{ dailyHours: 8 as const }, { runsThroughBreaks: true }])('preserves enabled pair flags through an optimistic capacity change: %j', async patch => {
  const { client, wrapper } = setup();
  const flags = { '305': true, '306': true };
  const previous = { dailyHoursByResource: {}, runsThroughBreaksResources: [], unitSplitEnabledByResource: flags };
  client.setQueryData(key, previous);
  let finish!: (value: GrindingPlanningBoardResourceCapacityResponse) => void;
  mocks.put.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const fixture = productionFixture(1, 1);
  const layout = buildPlanningBoardGanttLayout({ ...fixture.options, resources: ['305', '306'], mode: 'forward' });
  function Board() {
    const capacity = useKioskGrindingPlanningBoardResourceCapacity(true);
    const mutation = useUpdateKioskGrindingPlanningBoardResourceCapacity();
    return <PlanningBoardGanttDisplay layout={layout} singleResourceCd="305" resourceLanes={['305', '306']}
      unitSplitEnabledByResource={capacity.data?.unitSplitEnabledByResource} capacityLoaded={capacity.data !== undefined}
      scale={14} dailyHoursByResource={capacity.data?.dailyHoursByResource ?? {}} resourceNameMap={{}}
      capacityPending={false} capacityError={false} disabled={false} dragDisabled={false} resourceView selectedItemIds={new Set()}
      focusedSeiban={null} onFocusedSeibanChange={vi.fn()} onToggleItem={vi.fn()} onDueDrop={vi.fn()}
      onCapacityChange={() => mutation.mutate({ resourceCd: '305', ...patch })} />;
  }
  render(<Board />, { wrapper });
  expect(screen.getByRole('button', { name: '2台', exact: true })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: '8H' }));
  await waitFor(() => expect(mocks.put).toHaveBeenCalledWith({ resourceCd: '305', ...patch }));
  expect(client.getQueryData<GrindingPlanningBoardResourceCapacityResponse>(key)?.unitSplitEnabledByResource).toEqual(flags);
  expect(screen.getByRole('button', { name: '2台', exact: true })).toBeEnabled();
  await act(async () => finish(previous));
});
