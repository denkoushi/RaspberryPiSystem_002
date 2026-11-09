import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlanningBoardArrival } from '../usePlanningBoardArrival';

import type { GrindingPlanningBoardItem, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';

const mocks = vi.hoisted(() => ({ arrival: vi.fn(), first: vi.fn(), isPending: false, isError: false }));
vi.mock('../../../../api/hooks', () => ({
  useUpdateKioskGrindingPlanningBoardArrival: () => ({ mutateAsync: mocks.arrival, isPending: false, isError: false }),
  useUpdateKioskGrindingPlanningBoardFirstProcessArrival: () => ({ mutateAsync: mocks.first, isPending: mocks.isPending, isError: mocks.isError })
}));
vi.mock('../../usePersistedArrivalFilter', () => ({
  usePersistedArrivalFilter: () => ({ arrivalFilterEnabled: true, toggleArrivalFilter: vi.fn() })
}));

const item = { itemId: 'first', itemRevision: 'revision', version: 2, isFirstProcess: true,
  firstProcessState: null, arrived: false } as GrindingPlanningBoardItem;
const board = (items = [item], siteKey = 'site-a') => ({ siteKey, items } as GrindingPlanningBoardResponse);
const beforeMidnight = new Date('2026-11-06T14:59:00Z').getTime();
const afterMidnight = new Date('2026-11-06T15:01:00Z').getTime();
const initialBoard = board();
const setup = () => renderHook(({ data, now }) => usePlanningBoardArrival(data, now), {
  initialProps: { data: initialBoard, now: beforeMidnight }
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isPending = false;
  mocks.isError = false;
  mocks.first.mockImplementation(async ({ itemId, state }) => ({ itemId, firstProcessState: state }));
});

describe('usePlanningBoardArrival', () => {
  it.each(['arrived', 'excluded'] as const)('applies %s immediately across midnight, and clears it on the next board response', async (state) => {
    const hook = setup();
    await act(async () => { await hook.result.current.changeFirstProcessArrival(item, state); });
    expect(mocks.first).toHaveBeenCalledWith({ itemId: 'first', itemRevision: 'revision', overrideVersion: 2, state });
    const expected = { firstProcessState: state, arrived: state === 'arrived' };
    expect(hook.result.current.applyArrival(item)).toMatchObject(expected);
    hook.rerender({ data: initialBoard, now: afterMidnight });
    expect(hook.result.current.applyArrival(item)).toMatchObject(expected);
    hook.rerender({ data: board([{ ...item, ...expected }]), now: afterMidnight });
    // Passing the old object now proves that the acknowledged overlay was removed.
    expect(hook.result.current.applyArrival(item)).toBe(item);
  });

  it('drops the overlay when the next response disagrees, such as a newer placement or another kiosk', async () => {
    const hook = setup();
    await act(async () => { await hook.result.current.changeFirstProcessArrival(item, 'excluded'); });
    const automatic = { ...item, arrived: true, firstProcessState: null };
    hook.rerender({ data: board([automatic]), now: beforeMidnight });
    expect(hook.result.current.applyArrival(automatic)).toBe(automatic);
  });

  it('shows both buttons released on null and waits for server automatic arrival', async () => {
    const hook = setup();
    const pressed = { ...item, firstProcessState: 'arrived' as const, arrived: true };
    await act(async () => { await hook.result.current.changeFirstProcessArrival(pressed, null); });
    expect(hook.result.current.applyArrival(pressed)).toEqual({ ...pressed, firstProcessState: null });
    const automatic = { ...item, arrived: true };
    hook.rerender({ data: board([automatic]), now: beforeMidnight });
    expect(hook.result.current.applyArrival(automatic)).toBe(automatic);
  });

  it('switches state and isolates overlays by site', async () => {
    const hook = setup();
    await act(async () => { await hook.result.current.changeFirstProcessArrival(item, 'arrived'); });
    await act(async () => { await hook.result.current.changeFirstProcessArrival(item, 'excluded'); });
    expect(hook.result.current.applyArrival(item)).toMatchObject({ arrived: false, firstProcessState: 'excluded' });
    hook.rerender({ data: board([item], 'site-b'), now: beforeMidnight });
    expect(hook.result.current.applyArrival(item)).toBe(item);
  });

  it('preserves same-day arrival and midnight expiry for later processes', async () => {
    const later = { ...item, isFirstProcess: false };
    const hook = setup();
    mocks.arrival.mockResolvedValue({ itemId: item.itemId, manualArrivalDate: '2026-11-06' });
    await act(async () => { await hook.result.current.changeArrival(later, true); });
    expect(hook.result.current.applyArrival(later)).toMatchObject({ arrived: true, manualArrivalDate: '2026-11-06' });
    hook.rerender({ data: board([later]), now: afterMidnight });
    expect(hook.result.current.applyArrival(later)).toBe(later);
  });

  it('retains the current state on failure and exposes the existing error and pending flags', async () => {
    const hook = setup();
    mocks.first.mockRejectedValue(new Error('conflict'));
    await act(async () => { await hook.result.current.changeFirstProcessArrival(item, 'arrived'); });
    expect(hook.result.current.applyArrival(item)).toBe(item);
    mocks.isError = true;
    mocks.isPending = true;
    hook.rerender({ data: board(), now: beforeMidnight });
    expect(hook.result.current.arrivalError).toBe(true);
    expect(hook.result.current.arrivalPending).toBe(true);
  });

  it('serializes arrival mutations while a first-process write is pending', async () => {
    let finish!: (value: { itemId: string; firstProcessState: 'arrived' }) => void;
    mocks.first.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const hook = setup();
    await act(async () => {
      const writing = hook.result.current.changeFirstProcessArrival(item, 'arrived');
      await hook.result.current.changeArrival(item, true);
      await hook.result.current.changeFirstProcessArrival(item, 'excluded');
      finish({ itemId: item.itemId, firstProcessState: 'arrived' });
      await writing;
    });
    expect(mocks.first).toHaveBeenCalledTimes(1);
    expect(mocks.arrival).not.toHaveBeenCalled();
  });
});
