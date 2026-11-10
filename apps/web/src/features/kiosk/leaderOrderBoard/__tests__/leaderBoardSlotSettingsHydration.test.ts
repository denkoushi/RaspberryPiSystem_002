import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  leaderBoardSlotStorageKey,
  persistedLeaderBoardCapacityModeStorageKey,
  persistedLeaderBoardLaborModeStorageKey
} from '../constants';
import { useLeaderBoardResourceSlots } from '../useLeaderBoardResourceSlots';
import { usePersistedLeaderBoardCapacityMode } from '../usePersistedLeaderBoardCapacityMode';
import { usePersistedLeaderBoardLaborMode } from '../usePersistedLeaderBoardLaborMode';

const capacity = [480, 600, 480, 480, 480, 480, 600, 600, 480, 600];
const labor = [false, true, false, false, false, false, true, true, false, true];

function seed(device: string) {
  window.localStorage.setItem(leaderBoardSlotStorageKey(device), JSON.stringify({
    schemaVersion: 1, slotCount: 10, resourceCdBySlotIndex: ['305']
  }));
  window.localStorage.setItem(persistedLeaderBoardCapacityModeStorageKey('site', device), JSON.stringify({
    schemaVersion: 1, capacityMinutesBySlotIndex: capacity
  }));
  window.localStorage.setItem(persistedLeaderBoardLaborModeStorageKey('site', device), JSON.stringify({
    schemaVersion: 1, enabledBySlotIndex: labor
  }));
}

function useSettings(device: string, fallback: string[]) {
  const slots = useLeaderBoardResourceSlots({ scopeKey: device, fallbackAssignedResourceCds: fallback });
  const laborMode = usePersistedLeaderBoardLaborMode('site', device, slots.slotCount);
  const capacityMode = usePersistedLeaderBoardCapacityMode('site', device, slots.slotCount);
  return { ...slots, ...laborMode, ...capacityMode };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it.each(['mount', 'device change'])('restores all ten saved slot settings after 6 → 10 on %s', (scenario) => {
  seed('target');
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const counts: number[] = [];
  const { result, rerender } = renderHook(({ device }) => {
    const settings = useSettings(device, []);
    counts.push(settings.slotCount);
    return settings;
  }, { initialProps: { device: scenario === 'mount' ? 'target' : 'initial' } });
  if (scenario === 'device change') {
    counts.length = 0;
    writes.mockClear();
    rerender({ device: 'target' });
  }
  expect(counts[0]).toBe(6);
  expect(counts).toContain(10);
  expect(result.current.capacityMinutesBySlotIndex).toEqual(capacity);
  expect(result.current.laborEnabledBySlotIndex).toEqual(labor);
  for (const [key, field, expected] of [
    [persistedLeaderBoardCapacityModeStorageKey('site', 'target'), 'capacityMinutesBySlotIndex', capacity],
    [persistedLeaderBoardLaborModeStorageKey('site', 'target'), 'enabledBySlotIndex', labor]
  ] as const) {
    const saved = writes.mock.calls.filter(([writtenKey]) => writtenKey === key);
    expect(saved.length).toBeGreaterThan(0);
    for (const [, payload] of saved) expect(JSON.parse(payload)[field]).toEqual(expected);
    expect(JSON.parse(window.localStorage.getItem(key)!)[field]).toEqual(expected);
  }
});

describe.each(['getItem', 'setItem', 'storageGetter'] as const)('slot settings with failing %s', (failure) => {
  function failStorage() {
    const fail = () => { throw new DOMException('Storage unavailable', 'SecurityError'); };
    if (failure === 'storageGetter') vi.spyOn(window, 'localStorage', 'get').mockImplementation(fail);
    else vi.spyOn(Storage.prototype, failure).mockImplementation(fail);
  }

  it('keeps selected modes through resource slot resizing and fallback updates', () => {
    seed('device');
    failStorage();
    const { result, rerender } = renderHook(({ fallback }) => useSettings('device', fallback), {
      initialProps: { fallback: ['305'] }
    });
    act(() => {
      result.current.toggleCapacityForSlot(0);
      result.current.toggleLaborForSlot(0);
      result.current.setSlotCount(12);
      result.current.assignSlotCd(0, '401');
    });
    expect(result.current.capacityMinutesForSlot(0)).toBe(600);
    expect(result.current.isLaborEnabledForSlot(0)).toBe(true);
    rerender({ fallback: ['305', '999'] });
    expect(result.current.slotCount).toBe(12);
    expect(result.current.resourceCdBySlotIndex[0]).toBe('401');
    act(() => result.current.setSlotCount(4));
    act(() => result.current.setSlotCount(10));
    expect(result.current.capacityMinutesBySlotIndex).toEqual([
      600, failure === 'setItem' ? 600 : 480, 480, 480, 480, 480, 480, 480, 480, 480
    ]);
    expect(result.current.laborEnabledBySlotIndex).toEqual([
      true, failure === 'setItem', false, false, false, false, false, false, false, false
    ]);
  });

  it.each([false, true])('keeps slot count and placement on fallback updates (saved slots: %s)', (saved) => {
    if (saved) seed('device');
    failStorage();
    const { result, rerender } = renderHook(
      ({ scope, fallback }) => useLeaderBoardResourceSlots({ scopeKey: scope, fallbackAssignedResourceCds: fallback }),
      { initialProps: { scope: 'device', fallback: ['305'] } }
    );
    act(() => {
      result.current.setSlotCount(10);
      result.current.assignSlotCd(0, '401');
      result.current.assignSlotCd(9, '999');
    });
    const placement = [...result.current.resourceCdBySlotIndex];
    rerender({ scope: 'device', fallback: ['500', '305'] });
    expect(result.current.slotCount).toBe(10);
    expect(result.current.resourceCdBySlotIndex).toEqual(placement);
    rerender({ scope: 'other', fallback: ['500'] });
    expect(result.current.slotCount).toBe(6);
    expect(result.current.activeResourceCds).toEqual(['500']);
  });
});

it('continues reading saved slots when fallback resources change with working storage', () => {
  seed('device');
  const { result, rerender } = renderHook(
    ({ fallback }) => useLeaderBoardResourceSlots({ scopeKey: 'device', fallbackAssignedResourceCds: fallback }),
    { initialProps: { fallback: ['305'] } }
  );
  window.localStorage.setItem(leaderBoardSlotStorageKey('device'), JSON.stringify({
    schemaVersion: 1, slotCount: 8, resourceCdBySlotIndex: ['999', '401']
  }));
  rerender({ fallback: ['500'] });
  expect(result.current.slotCount).toBe(8);
  expect(result.current.activeResourceCds).toEqual(['999', '401']);
});
