import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QUEUE_KEY } from './reporter';

describe('browser kiosk error collection', () => {
  beforeEach(() => {
    vi.resetModules(); vi.useFakeTimers(); localStorage.clear();
    window.history.replaceState({}, '', '/kiosk/borrow');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });
  it('registers once and flushes window errors, rejections, online event and timer', async () => {
    const listeners = new Map<string, EventListener>();
    vi.spyOn(window, 'addEventListener').mockImplementation((name, listener) => { listeners.set(name, listener as EventListener); });
    const interval = vi.spyOn(window, 'setInterval');
    const send = vi.fn().mockResolvedValue(undefined);
    const { initializeKioskErrorTelemetry } = await import('./index');
    initializeKioskErrorTelemetry(send); initializeKioskErrorTelemetry(send);
    expect(interval).toHaveBeenCalledTimes(1);
    listeners.get('error')!(new ErrorEvent('error', { error: new TypeError('broken') }));
    listeners.get('unhandledrejection')!({ reason: { body: 'secret' } } as unknown as Event);
    await vi.advanceTimersByTimeAsync(5000);
    expect(send.mock.calls[0][0].logs.map((log: { context: { kind: string } }) => log.context.kind)).toEqual(['window_error', 'unhandled_rejection']);
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret');
    listeners.get('error')!(new ErrorEvent('error', { error: new Error('again') }));
    listeners.get('online')!(new Event('online'));
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('classifies API failures and slow successes while ignoring 401, cancellation, self-reporting', async () => {
    const { initializeKioskErrorTelemetry, reportKioskApi } = await import('./index');
    vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined); initializeKioskErrorTelemetry(send);
    const base = { url: '/orders?value=secret', method: 'get', durationMs: 10001 };
    reportKioskApi(base);
    reportKioskApi({ ...base, code: 'ECONNABORTED' });
    reportKioskApi({ ...base, status: 503 });
    reportKioskApi({ ...base, status: 400 });
    reportKioskApi({ ...base, status: 200 });
    reportKioskApi({ ...base, status: 401 });
    reportKioskApi({ ...base, code: 'ERR_CANCELED' });
    reportKioskApi({ ...base, url: '/clients/logs', status: 500 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(send.mock.calls[0][0].logs.map((log: { context: { kind: string } }) => log.context.kind)).toEqual(['api_network', 'api_timeout', 'api_5xx', 'api_4xx', 'slow_request']);
    expect(send.mock.calls[0][0].logs.map((log: { level: string }) => log.level)).toEqual(['ERROR', 'ERROR', 'ERROR', 'WARN', 'WARN']);
    expect(JSON.stringify(send.mock.calls)).not.toContain('secret');
    expect(JSON.parse(localStorage.getItem(QUEUE_KEY)!).queue).toHaveLength(0);
  });
});
