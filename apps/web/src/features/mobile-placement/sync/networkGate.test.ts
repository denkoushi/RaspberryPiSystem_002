import { describe, expect, it, vi } from 'vitest';

import { stubMobileConnection } from '../connectivityTestUtils';

import { canSyncNow, subscribeCanSync } from './networkGate';

const getConnection = stubMobileConnection();

describe('networkGate', () => {
  it('syncs only on wifi or ethernet', () => {
    for (const type of ['wifi', 'ethernet', 'cellular', 'none', 'bluetooth', 'wimax', undefined, 'unknown', 'other']) {
      getConnection().type = type;
      expect(canSyncNow(), String(type)).toBe(type === 'wifi' || type === 'ethernet');
    }
  });
  it('does not sync when the connection API is missing', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(canSyncNow()).toBe(false);
  });
  it('rejects offline even with wifi', () => {
    getConnection().type = 'wifi';
    vi.stubGlobal('navigator', { onLine: false, connection: getConnection() });
    expect(canSyncNow()).toBe(false);
  });
  it('notifies on connection and connectivity changes and unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanSync(listener);
    getConnection().dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('offline'));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    getConnection().dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('online'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
