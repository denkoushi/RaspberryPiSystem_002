import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useManualOrderCardState } from './useManualOrderCardState';

describe('useManualOrderCardState', () => {
  it('defaults known devices to idle and normalizes the map when device keys change', () => {
    const { result, rerender } = renderHook(({ keys }) => useManualOrderCardState(keys), {
      initialProps: { keys: ['device-a', 'device-b'] }
    });

    expect(result.current.activeDeviceScopeKey).toBe('');
    expect(result.current.statusMap).toEqual({ 'device-a': 'idle', 'device-b': 'idle' });
    act(() => result.current.setDeviceStatus('device-a', 'saving'));
    expect(result.current.statusMap).toEqual({ 'device-a': 'saving', 'device-b': 'idle' });
    act(() => result.current.setDeviceStatus('device-b', 'error'));
    act(() => result.current.clearDeviceStatus('device-a'));
    expect(result.current.statusMap).toEqual({ 'device-a': 'idle', 'device-b': 'error' });

    rerender({ keys: ['device-b', 'device-c'] });
    expect(result.current.statusMap).toEqual({ 'device-b': 'error', 'device-c': 'idle' });
  });

  it('keeps setDeviceStatus and clearDeviceStatus identities across rerenders and status updates', () => {
    const { result, rerender } = renderHook(() => useManualOrderCardState(['device-a']));
    const { setDeviceStatus, clearDeviceStatus } = result.current;
    const expectStableCallbacks = () => {
      expect(result.current.setDeviceStatus).toBe(setDeviceStatus);
      expect(result.current.clearDeviceStatus).toBe(clearDeviceStatus);
    };

    rerender();
    expectStableCallbacks();
    act(() => setDeviceStatus('device-a', 'saving'));
    expect(result.current.statusMap['device-a']).toBe('saving');
    expectStableCallbacks();
    act(() => setDeviceStatus('device-a', 'saving'));
    expectStableCallbacks();
    act(() => clearDeviceStatus('device-a'));
    expect(result.current.statusMap['device-a']).toBe('idle');
    expectStableCallbacks();
    act(() => clearDeviceStatus('device-a'));
    expectStableCallbacks();
    act(() => result.current.setActiveDeviceScopeKey('device-a'));
    expect(result.current.activeDeviceScopeKey).toBe('device-a');
    expectStableCallbacks();
  });
});
