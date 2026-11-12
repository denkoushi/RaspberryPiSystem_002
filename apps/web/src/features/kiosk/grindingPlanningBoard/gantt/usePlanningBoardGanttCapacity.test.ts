import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { usePlanningBoardGantt } from './usePlanningBoardGantt';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), mutateAsync: vi.fn() }));
vi.mock('../../../../api/hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../api/hooks')>(),
  useKioskGrindingPlanningBoardResourceMinutes: () => ({ data: undefined }),
  useUpdateKioskGrindingPlanningBoardResourceMinutesSource: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useKioskGrindingPlanningBoardResourceCapacity: () => ({ data: { dailyHoursByResource: { '021': 24, '022': 10 }, runsThroughBreaksResources: [] } }),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutateAsync, isPending: false, isError: false })
}));

beforeEach(() => { vi.clearAllMocks(); window.localStorage.clear(); });

function setup() {
  return renderHook(() => usePlanningBoardGantt({ enabled: true, preferenceScope: 'capacity', items: [], resources: ['021', '022'],
    seibanOrder: [], view: 'resource', allocation: 'alternate', today: '2026-11-13', category: 'cutting' }));
}

it('writes one machine at a time in order when both machines are given', async () => {
  const order: string[] = [];
  let release!: () => void;
  mocks.mutateAsync.mockImplementation(({ resourceCd }: { resourceCd: string }) => {
    order.push(resourceCd);
    return resourceCd === '021' ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve();
  });
  const hook = setup();
  act(() => hook.result.current.changeCapacity(['021', '022'], 24));
  expect(order).toEqual(['021']);
  await act(async () => { release(); await Promise.resolve(); await Promise.resolve(); });
  expect(mocks.mutateAsync.mock.calls.map(([payload]) => payload)).toEqual([
    { resourceCd: '021', dailyHours: 24 }, { resourceCd: '022', dailyHours: 24 }
  ]);
  expect(mocks.mutate).not.toHaveBeenCalled();
});

it('writes breaks to both machines', async () => {
  mocks.mutateAsync.mockResolvedValue(undefined);
  const hook = setup();
  await act(async () => { hook.result.current.changeBreaks(['021', '022'], true); await Promise.resolve(); await Promise.resolve(); });
  expect(mocks.mutateAsync.mock.calls.map(([payload]) => payload)).toEqual([
    { resourceCd: '021', runsThroughBreaks: true }, { resourceCd: '022', runsThroughBreaks: true }
  ]);
});

it('keeps the single-machine write unchanged', () => {
  const hook = setup();
  act(() => hook.result.current.changeCapacity('021', 8));
  expect(mocks.mutate).toHaveBeenCalledWith({ resourceCd: '021', dailyHours: 8 });
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
});
