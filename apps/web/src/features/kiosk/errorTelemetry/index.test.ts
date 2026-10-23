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
  it('shares the existing timer for network windows even while hidden', async () => {
    vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    const interval = vi.spyOn(window, 'setInterval');
    const send = vi.fn().mockResolvedValue(undefined);
    const { initializeKioskErrorTelemetry, reportKioskApi } = await import('./index');
    initializeKioskErrorTelemetry(send); initializeKioskErrorTelemetry(send);
    reportKioskApi({ url: '/orders?secret=input', status: 200, durationMs: 120 });
    await vi.advanceTimersByTimeAsync(300000);
    expect(interval).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].logs[0].context).toMatchObject({ category: 'kiosk_net_stats', requests: 1, p95Ms: 120 });
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT', 'ERR_NETWORK'])('keeps background %s in network stats only and records foreground failures', async (code) => {
    vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const { initializeKioskErrorTelemetry, reportKioskApi } = await import('./index');
    initializeKioskErrorTelemetry(send);
    const input = { url: '/arbitrary-path', durationMs: 5000, code };
    reportKioskApi({ ...input, kioskTelemetry: 'background' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(send).not.toHaveBeenCalled();
    expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
    reportKioskApi(input);
    await vi.advanceTimersByTimeAsync(5000);
    expect(send.mock.calls[0][0].logs).toEqual([expect.objectContaining({ level: 'ERROR', context: expect.objectContaining({
      category: 'kiosk_ui_error', kind: code === 'ERR_NETWORK' ? 'api_network' : 'api_timeout'
    }) })]);
    await vi.advanceTimersByTimeAsync(290000);
    expect(send.mock.calls[1][0].logs[0].context).toMatchObject({ category: 'kiosk_net_stats', requests: 2, failures: 2 });
  });
  it('still records background server errors and slow successes', async () => {
    vi.spyOn(window, 'addEventListener').mockImplementation(() => undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const { initializeKioskErrorTelemetry, reportKioskApi } = await import('./index');
    initializeKioskErrorTelemetry(send);
    for (const status of [503, 400, 200]) reportKioskApi({ url: '/arbitrary-path', status, durationMs: 10001, kioskTelemetry: 'background' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(send.mock.calls[0][0].logs.map((log: { context: { kind: string } }) => log.context.kind)).toEqual(['api_5xx', 'api_4xx', 'slow_request']);
  });
  it.each(['getLocalLlmAvailability', 'getDeployStatus'] as const)('passes the background marker through HTTP telemetry for %s', async (request) => {
    const telemetry = await import('./index');
    const report = vi.spyOn(telemetry, 'reportKioskApi');
    const { api } = await import('../../../api/http');
    const system = await import('../../../api/domains/system');
    const { AxiosError } = await import('axios');
    const adapter = api.defaults.adapter;
    try {
      api.defaults.adapter = async (config) => { throw new AxiosError('timeout', 'ECONNABORTED', config); };
      await expect(system[request]()).rejects.toHaveProperty('code', 'ECONNABORTED');
      expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kioskTelemetry: 'background', code: 'ECONNABORTED' }));
      expect(localStorage.getItem(QUEUE_KEY)).toBeNull();
      api.defaults.adapter = async (config) => ({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
      await system[request]();
      expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ kioskTelemetry: 'background', status: 200 }));
    } finally { api.defaults.adapter = adapter; }
  });
});
