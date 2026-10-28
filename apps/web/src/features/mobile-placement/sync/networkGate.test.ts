import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetMobileConnectivityForTests } from '../connectivity';

import { canSyncNow, subscribeCanSync } from './networkGate';

let connection: EventTarget & { type?: string };
beforeEach(() => {
  connection = new EventTarget();
  vi.stubGlobal('navigator', { onLine: true, connection });
});
afterEach(() => { resetMobileConnectivityForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('networkGate', () => {
  it('syncs only on wifi or ethernet', () => {
    for (const type of ['wifi', 'ethernet', 'cellular', 'none', 'bluetooth', 'wimax', undefined, 'unknown', 'other']) {
      connection.type = type;
      expect(canSyncNow(), String(type)).toBe(type === 'wifi' || type === 'ethernet');
    }
  });
  it('does not sync when the connection API is missing', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(canSyncNow()).toBe(false);
  });
  it('rejects offline even with wifi', () => {
    connection.type = 'wifi';
    vi.stubGlobal('navigator', { onLine: false, connection });
    expect(canSyncNow()).toBe(false);
  });
  it('notifies on connection and connectivity changes and unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCanSync(listener);
    connection.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('offline'));
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    connection.dispatchEvent(new Event('change'));
    window.dispatchEvent(new Event('online'));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
