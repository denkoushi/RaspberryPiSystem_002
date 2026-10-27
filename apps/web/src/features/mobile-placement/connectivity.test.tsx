import { onlineManager } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/http';

import { canUseMobileNetwork, MOBILE_REQUEST_TIMEOUT_MS, mobileRequest, resetMobileConnectivityForTests, useMobileConnectivity } from './connectivity';

vi.mock('../../api/http', () => ({ api: { get: vi.fn() } }));

beforeEach(() => {
  vi.resetAllMocks();
  resetMobileConnectivityForTests();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
});
afterEach(() => { resetMobileConnectivityForTests(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('mobile connectivity', () => {
  it.each([200, 404, 503])('recovers on a background HTTP %s response, notifies subscribers and stops probing', async (status) => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockRejectedValueOnce(new Error('network')).mockResolvedValue({ status });
    const { result } = renderHook(useMobileConnectivity);
    await act(async () => { await mobileRequest(() => Promise.reject(new Error('network'))).catch(() => {}); });
    expect(result.current).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(14_999); });
    expect(api.get).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current).toBe(false);
    expect(api.get).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current).toBe(true);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get).toHaveBeenLastCalledWith('/kiosk/mobile-local-data/versions', {
      kioskTelemetry: 'background', timeout: 3000, validateStatus: expect.any(Function)
    });
    expect(vi.mocked(api.get).mock.calls[1][1]?.validateStatus?.(status)).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(45_000); });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('skips probes while browser offline and stops probing on the online event', async () => {
    vi.useFakeTimers();
    await mobileRequest(() => Promise.reject(new Error('network'))).catch(() => {});
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.get).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    expect(canUseMobileNetwork()).toBe(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.get).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([60_000, 180_000])('allows requests longer than three seconds with a %s ms limit', async (timeoutMs) => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const request = mobileRequest(() => new Promise<string>((resolve) => { finish = resolve; }), { timeoutMs });
    const settled = vi.fn();
    void request.then(settled, settled);
    await vi.advanceTimersByTimeAsync(timeoutMs - 1);
    expect(settled).not.toHaveBeenCalled();
    expect(canUseMobileNetwork()).toBe(true);
    finish('ok');
    await expect(request).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('latches only when a custom deadline is exceeded without an HTTP response', async () => {
    vi.useFakeTimers();
    const request = expect(mobileRequest(() => new Promise(() => {}), { timeoutMs: 60_000 })).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(60_000);
    await request;
    expect(canUseMobileNetwork()).toBe(false);
  });

  it('reads browser offline synchronously, updates React and never calls the request', async () => {
    const request = vi.fn();
    const { result } = renderHook(useMobileConnectivity);
    expect(result.current).toBe(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(canUseMobileNetwork()).toBe(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
    await expect(mobileRequest(request)).rejects.toThrow('offline');
    expect(request).not.toHaveBeenCalled();
  });

  it('shares transport failures, skips further requests and resets on online without changing QueryClient', async () => {
    const setOnline = vi.spyOn(onlineManager, 'setOnline');
    const { result } = renderHook(useMobileConnectivity);
    await act(async () => { await expect(mobileRequest(() => Promise.reject(new Error('network')))).rejects.toThrow('network'); });
    expect(result.current).toBe(false);
    const request = vi.fn().mockResolvedValue('ok');
    await expect(mobileRequest(request)).rejects.toThrow('offline');
    expect(request).not.toHaveBeenCalled();
    expect(setOnline).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new Event('online')));
    expect(result.current).toBe(true);
    await expect(mobileRequest(request)).resolves.toBe('ok');
  });

  it('bounds an unresponsive first request, skips subsequent requests and recovers on a late success', async () => {
    vi.useFakeTimers();
    let finish!: (value: string) => void;
    const request = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const first = expect(mobileRequest(request)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(MOBILE_REQUEST_TIMEOUT_MS);
    await first;
    expect(canUseMobileNetwork()).toBe(false);
    await expect(mobileRequest(request)).rejects.toThrow('offline');
    expect(request).toHaveBeenCalledOnce();
    finish('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(canUseMobileNetwork()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([404, 409, 503])('does not confuse HTTP %s with an unreachable server', async (status) => {
    const error = { isAxiosError: true, response: { status } };
    await expect(mobileRequest(() => Promise.reject(error))).rejects.toBe(error);
    expect(canUseMobileNetwork()).toBe(true);
  });
});
