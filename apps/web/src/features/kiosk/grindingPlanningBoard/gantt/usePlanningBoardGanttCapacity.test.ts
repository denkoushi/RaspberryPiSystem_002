import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, useLayoutEffect } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { api } from '../../../../api/client';
import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from '../offline/planningBoardOfflineConfig';
import { PlanningBoardOfflineProvider, usePlanningBoardOffline } from '../offline/PlanningBoardOfflineProvider';

import { usePlanningBoardGantt } from './usePlanningBoardGantt';

import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() }));
vi.mock('../../../../api/hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../api/hooks')>(),
  useKioskGrindingPlanningBoardResourceMinutes: () => ({ data: undefined }),
  useUpdateKioskGrindingPlanningBoardResourceMinutesSource: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useKioskGrindingPlanningBoardResourceCapacity: () => ({ data: { dailyHoursByResource: { '021': 24, '022': 10 }, runsThroughBreaksResources: [] } }),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutateAsync, isPending: false, isError: false })
}));

vi.mock('../offline/planningBoardOfflineQueries', () => ({
  useOfflineResourceMinutes: () => ({ data: undefined }),
  useOfflineResourceCapacity: () => ({ data: { dailyHoursByResource: {}, runsThroughBreaksResources: [] } })
}));

beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });

afterEach(() => vi.restoreAllMocks());

function setup(wrapper?: (props: { children: ReactNode }) => ReactNode) {
  return renderHook(() => usePlanningBoardGantt({ enabled: true, preferenceScope: 'capacity', items: [], resources: ['021', '022'],
    seibanOrder: [], view: 'resource', allocation: 'alternate', today: '2026-11-13', category: 'cutting' }), { wrapper });
}

it('writes one machine at a time in order when both machines are given', async () => {
  const order: string[] = [];
  let release!: () => void;
  mocks.mutateAsync.mockImplementation(({ resourceCd }: { resourceCd: string }) => {
    order.push(resourceCd);
    return resourceCd === '021' ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  });
  const hook = setup();
  act(() => hook.result.current.changeCapacity(['021', '022'], 24, false));
  expect(order).toEqual(['021']);
  await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); });
  expect(mocks.mutateAsync.mock.calls.map(([payload]) => payload)).toEqual([
    { resourceCd: '021', dailyHours: 24, runsThroughBreaks: false }, { resourceCd: '022', dailyHours: 24, runsThroughBreaks: false }
  ]);
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it('writes breaks to both machines', async () => {
  mocks.mutateAsync.mockResolvedValue(undefined);
  const hook = setup();
  await act(async () => { hook.result.current.changeBreaks(['021', '022'], true, 8); await Promise.resolve(); await Promise.resolve(); });
  expect(mocks.mutateAsync.mock.calls.map(([payload]) => payload)).toEqual([
    { resourceCd: '021', dailyHours: 8, runsThroughBreaks: true }, { resourceCd: '022', dailyHours: 8, runsThroughBreaks: true }
  ]);
});

it('keeps the single-machine write unchanged', () => {
  const hook = setup();
  act(() => hook.result.current.changeCapacity('021', 8));
  act(() => hook.result.current.changeBreaks('021', true));
  expect(mocks.mutate.mock.calls.map(([payload]) => payload)).toEqual([
    { resourceCd: '021', dailyHours: 8 }, { resourceCd: '021', runsThroughBreaks: true }
  ]);
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});

it('stops after a failed first write and does not write the second machine', async () => {
  mocks.mutateAsync.mockRejectedValueOnce(new Error('save failed'));
  const hook = setup();
  await act(async () => { hook.result.current.changeCapacity(['021', '022'], 10, false); await Promise.resolve(); await Promise.resolve(); });
  expect(mocks.mutateAsync).toHaveBeenCalledTimes(1);
});

it.each(['hours', 'breaks', 'unitSplit'] as const)('refreshes offline capacity reads after a failed %s write', async (change) => {
  vi.spyOn(api, 'get').mockResolvedValue({ status: 200, data: { dailyHoursByResource: {}, runsThroughBreaksResources: [] } });
  mocks.mutateAsync.mockReset();
  if (change !== 'unitSplit') mocks.mutateAsync.mockResolvedValueOnce(undefined);
  mocks.mutateAsync.mockRejectedValueOnce(new Error('save failed'));
  let offline!: ReturnType<typeof usePlanningBoardOffline>;
  const reads = ['board', 'load', 'resource-capacity'].map(() => vi.fn().mockResolvedValue({}));
  function Harness({ children }: { children: ReactNode }) {
    offline = usePlanningBoardOffline();
    const { registerRead } = offline;
    useLayoutEffect(() => {
      const unregister = ['board', 'load', 'resource-capacity'].map((key, index) =>
        registerRead(key, { read: reads[index], commit: () => undefined }));
      return () => unregister.forEach((remove) => remove());
    }, [registerRead]);
    return children;
  }
  const hook = setup(({ children }) => createElement(PlanningBoardOfflineProvider,
    { config: { ...DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG, enabled: true } }, createElement(Harness, null, children)));
  await waitFor(() => expect(offline.snapshot.phase).toBe('online'));
  reads.forEach((read) => read.mockClear());
  act(() => {
    if (change === 'hours') hook.result.current.changeCapacity(['021', '022'], 10, false);
    else if (change === 'breaks') hook.result.current.changeBreaks(['021', '022'], true, 8);
    else hook.result.current.changeUnitSplit('021', true);
  });
  await waitFor(() => reads.forEach((read) => expect(read).toHaveBeenCalledTimes(1)));
  reads.forEach((read) => expect(read).toHaveBeenCalledTimes(1));
  expect(mocks.mutateAsync.mock.calls.map(([payload]) => payload.resourceCd)).toEqual(change === 'unitSplit' ? ['021'] : ['021', '022']);
});
