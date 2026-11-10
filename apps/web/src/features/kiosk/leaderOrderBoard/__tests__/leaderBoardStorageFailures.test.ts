import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  persistedLeaderBoardCapacityModeStorageKey,
  persistedLeaderBoardDeviceScopeStorageKey,
  persistedLeaderBoardLaborModeStorageKey
} from '../constants';
import { isLeaderboardBoardClientPerfEnabled } from '../leaderboardBoardClientPerf';
import { useLeaderBoardResourceSlots } from '../useLeaderBoardResourceSlots';
import { useLeaderOrderBoardDeviceContext } from '../useLeaderOrderBoardDeviceContext';
import { usePersistedLeaderBoardCapacityMode } from '../usePersistedLeaderBoardCapacityMode';
import { usePersistedLeaderBoardDeviceScope } from '../usePersistedLeaderBoardDeviceScope';
import { usePersistedLeaderBoardGanttMode } from '../usePersistedLeaderBoardGanttMode';
import { usePersistedLeaderBoardLaborMode } from '../usePersistedLeaderBoardLaborMode';
import { usePersistedLeaderBoardSeibanEval } from '../usePersistedLeaderBoardSeibanEval';

vi.mock('../../../../api/hooks', () => ({
  useKioskProductionScheduleManualOrderSiteDevices: () => ({ data: undefined }),
  useKioskProductionScheduleManualOrderResourceAssignments: () => ({ data: undefined }),
  useKioskSites: () => ({ data: undefined })
}));
vi.mock('../../../../api/client', () => ({ postKioskProductionScheduleLeaderboardClientPerf: vi.fn() }));
vi.mock('../../../../config/productionBuildConfig', () => ({
  readProductionBuildConfig: () => ({ leaderboardBoardClientPerfLog: false })
}));

const resources = ['305'];
const devices = ['DeviceA', 'DeviceB'];
const history = ['A', 'B'];

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe.each(['getItem', 'setItem', 'storageGetter'] as const)('unavailable localStorage: %s', (failure) => {
  function failStorage() {
    const fail = () => { throw new DOMException('Storage unavailable', failure === 'setItem' ? 'QuotaExceededError' : 'SecurityError'); };
    if (failure === 'storageGetter') vi.spyOn(window, 'localStorage', 'get').mockImplementation(fail);
    else vi.spyOn(Storage.prototype, failure).mockImplementation(fail);
  }

  it('hydrates resource slots from fallback and keeps assignments in memory', () => {
    failStorage();
    const { result, rerender } = renderHook(() => useLeaderBoardResourceSlots({ scopeKey: 'test', fallbackAssignedResourceCds: resources }));
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.activeResourceCds).toEqual(['305']);
    act(() => result.current.assignSlotCd(0, '401'));
    rerender();
    expect(result.current.activeResourceCds).toEqual(['401']);
  });

  it('keeps labor mode in memory', () => {
    failStorage();
    const { result, rerender } = renderHook(() => usePersistedLeaderBoardLaborMode('site', 'device', 2));
    expect(result.current.laborEnabledBySlotIndex).toEqual([false, false]);
    act(() => result.current.toggleLaborForSlot(0));
    rerender();
    expect(result.current.laborEnabledBySlotIndex).toEqual([true, false]);
  });

  it('keeps gantt mode in memory', () => {
    failStorage();
    const { result, rerender } = renderHook(() => usePersistedLeaderBoardGanttMode('site', 'device'));
    expect(result.current.ganttEnabled).toBe(false);
    act(() => result.current.toggleGanttMode());
    rerender();
    expect(result.current.ganttEnabled).toBe(true);
  });

  it('keeps seiban evaluation and ordering in memory', () => {
    failStorage();
    const { result, rerender } = renderHook(() => usePersistedLeaderBoardSeibanEval('site', 'device', history));
    expect(result.current.seibanEvalEnabled).toBe(false);
    expect(result.current.mergedRegisteredSeibanOrder).toEqual(history);
    act(() => {
      result.current.setSeibanEvalEnabled(true);
      result.current.moveRegisteredSeibanToRank('B', 1);
    });
    rerender();
    expect(result.current.seibanEvalEnabled).toBe(true);
    expect(result.current.mergedRegisteredSeibanOrder).toEqual(['B', 'A']);
  });

  it('keeps capacity mode in memory', () => {
    failStorage();
    const { result, rerender } = renderHook(() => usePersistedLeaderBoardCapacityMode('site', 'device', 2));
    expect(result.current.capacityMinutesBySlotIndex).toEqual([480, 480]);
    act(() => result.current.toggleCapacityForSlot(0));
    rerender();
    expect(result.current.capacityMinutesBySlotIndex).toEqual([600, 480]);
  });

  it('preserves capacity choices when resizing slots and reloads on scope changes', () => {
    window.localStorage.setItem(persistedLeaderBoardCapacityModeStorageKey('site', 'device'),
      JSON.stringify({ schemaVersion: 1, capacityMinutesBySlotIndex: [480, 600] }));
    failStorage();
    const { result, rerender } = renderHook(
      ({ device, count }) => usePersistedLeaderBoardCapacityMode('site', device, count),
      { initialProps: { device: 'device', count: 2 } }
    );
    act(() => result.current.toggleCapacityForSlot(0));
    const second = failure === 'setItem' ? 600 : 480;
    rerender({ device: 'device', count: 3 });
    expect(result.current.capacityMinutesBySlotIndex).toEqual([600, second, 480]);
    rerender({ device: 'device', count: 1 });
    expect(result.current.capacityMinutesBySlotIndex).toEqual([600]);
    rerender({ device: 'device', count: 3 });
    expect(result.current.capacityMinutesBySlotIndex).toEqual([600, 480, 480]);
    rerender({ device: 'other', count: 2 });
    expect(result.current.capacityMinutesBySlotIndex).toEqual([480, 480]);
    rerender({ device: 'device', count: 2 });
    expect(result.current.capacityMinutesBySlotIndex).toEqual([480, second]);
  });

  it('preserves labor choices when resizing slots and reloads on scope changes', () => {
    window.localStorage.setItem(persistedLeaderBoardLaborModeStorageKey('site', 'device'),
      JSON.stringify({ schemaVersion: 1, enabledBySlotIndex: [false, true] }));
    failStorage();
    const { result, rerender } = renderHook(
      ({ device, count }) => usePersistedLeaderBoardLaborMode('site', device, count),
      { initialProps: { device: 'device', count: 2 } }
    );
    act(() => result.current.toggleLaborForSlot(0));
    const second = failure === 'setItem';
    rerender({ device: 'device', count: 3 });
    expect(result.current.laborEnabledBySlotIndex).toEqual([true, second, false]);
    rerender({ device: 'device', count: 1 });
    expect(result.current.laborEnabledBySlotIndex).toEqual([true]);
    rerender({ device: 'device', count: 3 });
    expect(result.current.laborEnabledBySlotIndex).toEqual([true, false, false]);
    rerender({ device: 'other', count: 2 });
    expect(result.current.laborEnabledBySlotIndex).toEqual([false, false]);
    rerender({ device: 'device', count: 2 });
    expect(result.current.laborEnabledBySlotIndex).toEqual([false, second]);
  });

  it('keeps the selected device in memory', () => {
    failStorage();
    const { result, rerender } = renderHook(() => usePersistedLeaderBoardDeviceScope('site', [...devices]));
    expect(result.current.activeDeviceScopeKey).toBe('DeviceA');
    act(() => result.current.setActiveDeviceScopeKey('DeviceB'));
    rerender();
    expect(result.current.activeDeviceScopeKey).toBe('DeviceB');
  });

  it('preserves the selected device when devices are added or reordered', () => {
    window.localStorage.setItem(persistedLeaderBoardDeviceScopeStorageKey('site'),
      JSON.stringify({ schemaVersion: 1, deviceScopeKey: 'DeviceA' }));
    failStorage();
    const { result, rerender } = renderHook(
      ({ keys }) => usePersistedLeaderBoardDeviceScope('site', keys),
      { initialProps: { keys: devices } }
    );
    act(() => result.current.setActiveDeviceScopeKey('DeviceB'));
    rerender({ keys: ['DeviceC', ...devices] });
    expect(result.current.activeDeviceScopeKey).toBe('DeviceB');
    rerender({ keys: ['DeviceA', 'DeviceC', 'DeviceB'] });
    expect(result.current.activeDeviceScopeKey).toBe('DeviceB');
  });

  it('resolves a removed device from storage or the first available device', () => {
    window.localStorage.setItem(persistedLeaderBoardDeviceScopeStorageKey('site'),
      JSON.stringify({ schemaVersion: 1, deviceScopeKey: 'DeviceA' }));
    failStorage();
    const { result, rerender } = renderHook(
      ({ keys }) => usePersistedLeaderBoardDeviceScope('site', keys),
      { initialProps: { keys: devices } }
    );
    act(() => result.current.setActiveDeviceScopeKey('DeviceB'));
    rerender({ keys: ['DeviceC', 'DeviceA'] });
    expect(result.current.activeDeviceScopeKey).toBe(failure === 'setItem' ? 'DeviceA' : 'DeviceC');
    rerender({ keys: ['DeviceD'] });
    expect(result.current.activeDeviceScopeKey).toBe('DeviceD');
    rerender({ keys: [] });
    expect(result.current.activeDeviceScopeKey).toBe('');
  });

  it('reloads the selected device when the site changes', () => {
    window.localStorage.setItem(persistedLeaderBoardDeviceScopeStorageKey('other'),
      JSON.stringify({ schemaVersion: 1, deviceScopeKey: 'DeviceC' }));
    failStorage();
    const { result, rerender } = renderHook(
      ({ site }) => usePersistedLeaderBoardDeviceScope(site, ['DeviceA', 'DeviceB', 'DeviceC']),
      { initialProps: { site: 'site' } }
    );
    act(() => result.current.setActiveDeviceScopeKey('DeviceB'));
    rerender({ site: 'other' });
    expect(result.current.activeDeviceScopeKey).toBe(failure === 'setItem' ? 'DeviceC' : 'DeviceA');
  });

  it('keeps the selected site in memory', () => {
    failStorage();
    const { result, rerender } = renderHook(() => useLeaderOrderBoardDeviceContext());
    expect(result.current.siteKey).toBe('第2工場');
    act(() => result.current.handleSiteChange('第1工場'));
    rerender();
    expect(result.current.siteKey).toBe('第1工場');
  });

  it('defaults performance logging to disabled without a stored value', () => {
    failStorage();
    expect(isLeaderboardBoardClientPerfEnabled()).toBe(false);
  });

  it.each(['1', '0'])('uses the performance URL flag %s despite storage failures', (flag) => {
    window.history.replaceState(null, '', `/?leaderboardPerf=${flag}`);
    failStorage();
    if (failure === 'setItem') vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('Storage unavailable', 'SecurityError'); });
    expect(isLeaderboardBoardClientPerfEnabled()).toBe(flag === '1');
  });
});

it('loads and persists device selections per site with working storage', () => {
  window.localStorage.setItem(persistedLeaderBoardDeviceScopeStorageKey('site'),
    JSON.stringify({ schemaVersion: 1, deviceScopeKey: 'DeviceB' }));
  window.localStorage.setItem(persistedLeaderBoardDeviceScopeStorageKey('other'),
    JSON.stringify({ schemaVersion: 1, deviceScopeKey: 'DeviceA' }));
  const { result, rerender } = renderHook(
    ({ site, keys }) => usePersistedLeaderBoardDeviceScope(site, keys),
    { initialProps: { site: 'site', keys: [] as string[] } }
  );
  rerender({ site: 'site', keys: devices });
  expect(result.current.activeDeviceScopeKey).toBe('DeviceB');
  act(() => result.current.setActiveDeviceScopeKey('DeviceA'));
  expect(JSON.parse(window.localStorage.getItem(persistedLeaderBoardDeviceScopeStorageKey('site'))!))
    .toEqual({ schemaVersion: 1, deviceScopeKey: 'DeviceA' });
  act(() => result.current.setActiveDeviceScopeKey('DeviceB'));
  rerender({ site: 'other', keys: devices });
  expect(result.current.activeDeviceScopeKey).toBe('DeviceA');
  rerender({ site: 'site', keys: devices });
  expect(result.current.activeDeviceScopeKey).toBe('DeviceB');
});
