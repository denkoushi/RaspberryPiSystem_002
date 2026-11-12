import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { usePlanningBoardGantt } from './usePlanningBoardGantt';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), pending: false }));
vi.mock('../../../../api/hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../api/hooks')>(),
  useKioskGrindingPlanningBoardResourceMinutes: () => ({ data: undefined }),
  useUpdateKioskGrindingPlanningBoardResourceMinutesSource: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useKioskGrindingPlanningBoardResourceCapacity: () => ({ data: { dailyHoursByResource: { '021': 24, '022': 10 }, runsThroughBreaksResources: [] } }),
  useUpdateKioskGrindingPlanningBoardResourceCapacity: () => ({ mutate: mocks.mutate, mutateAsync: mocks.mutateAsync, isPending: mocks.pending, isError: false })
}));

beforeEach(() => { vi.clearAllMocks(); mocks.pending = false; window.localStorage.clear(); });

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


it('keeps capacity callbacks stable across mutation objects while reading the latest pending state', () => {
  const hook = setup();
  const { changeCapacity, changeBreaks, changeUnitSplit } = hook.result.current;
  hook.rerender();
  expect(hook.result.current.changeCapacity).toBe(changeCapacity);
  expect(hook.result.current.changeBreaks).toBe(changeBreaks);
  expect(hook.result.current.changeUnitSplit).toBe(changeUnitSplit);
  mocks.pending = true;
  hook.rerender();
  act(() => { changeCapacity('021', 8); changeBreaks('021', true); changeUnitSplit('021', true); });
  expect(mocks.mutate).not.toHaveBeenCalled();
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  mocks.pending = false;
  hook.rerender();
  act(() => changeCapacity('021', 10));
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ resourceCd: '021', dailyHours: 10 });
});
