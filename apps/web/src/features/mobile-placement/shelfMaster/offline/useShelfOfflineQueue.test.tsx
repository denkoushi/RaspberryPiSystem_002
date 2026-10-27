import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../../../api/http';
import { canUseMobileNetwork, resetMobileConnectivityForTests } from '../../connectivity';

import { createShelfOfflineQueueStore } from './shelfOfflineQueueStore';
import { useShelfOfflineQueue } from './useShelfOfflineQueue';

import type { ShelfQueueRecord } from './shelfOfflineQueueStore';
import type { ReactNode } from 'react';

vi.mock('../../../../api/http', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn() } }));
const input = { shelfCodeRaw: '電気室 北', displayLabel: '上段', photo: { contentType: 'image/jpeg' as const, dataBase64: '/9j/' } };
const record: ShelfQueueRecord = { ...input, id: 'saved', createdAt: '2026-10-27T00:00:00Z', stage: 'unregistered', status: 'pending' };
const responseError = (status: number) => ({ isAxiosError: true, response: { status, data: { message: 'サーバーのメッセージ' } } });
function mount(store = createShelfOfflineQueueStore()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const hook = renderHook(() => useShelfOfflineQueue(store), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, store };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  vi.mocked(api.post).mockResolvedValue({ shelf: { shelfCodeRaw: input.shelfCodeRaw, isStructured: true } });
  vi.mocked(api.put).mockResolvedValue({ photoUpdatedAt: '2026-10-27T00:00:00Z' });
});
afterEach(() => { resetMobileConnectivityForTests(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('shelf offline queue', () => {
  it('flushes pending shelves after the background probe recovers without an online event', async () => {
    vi.useFakeTimers();
    vi.mocked(api.get).mockResolvedValue({ status: 200 });
    vi.mocked(api.post).mockRejectedValueOnce(new Error('network'));
    const { result, store } = mount();
    await act(async () => { await result.current.submit(input); });
    expect(canUseMobileNetwork()).toBe(false);
    expect(result.current.records).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(canUseMobileNetwork()).toBe(true);
    expect(result.current.records).toEqual([]);
    expect(await store.list()).toEqual([]);
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.put).toHaveBeenCalledOnce();
  });

  it.each(['post', 'put'] as const)('allows a slow shelf %s with matching 60-second deadlines', async (method) => {
    vi.useFakeTimers();
    vi.mocked(api[method]).mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ data: {} }), 59_000);
    }));
    const { result } = mount();
    let submission!: ReturnType<typeof result.current.submit>;
    act(() => { submission = result.current.submit(input); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3001); });
    expect(canUseMobileNetwork()).toBe(true);
    expect(api[method]).toHaveBeenCalledWith(expect.any(String), expect.any(Object), { timeout: 60_000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(55_999); expect(await submission).toBe('sent'); });
    expect(result.current.records).toEqual([]);
    expect(api[method]).toHaveBeenCalledOnce();
  });

  it('persists before registration, persists the registered stage before uploading, and removes only after upload', async () => {
    const store = createShelfOfflineQueueStore();
    vi.mocked(api.post).mockImplementationOnce(async () => {
      expect(await store.list()).toEqual([expect.objectContaining({ ...input, stage: 'unregistered', status: 'pending' })]);
      return { shelf: { shelfCodeRaw: input.shelfCodeRaw, isStructured: true } };
    });
    let finish!: (value: { photoUpdatedAt: string }) => void;
    vi.mocked(api.put).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = mount(store);
    let submission!: ReturnType<typeof result.current.submit>;
    act(() => { submission = result.current.submit(input); });
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(await store.list()).toEqual([expect.objectContaining({ ...input, stage: 'registered' })]);
    await act(async () => { finish({ photoUpdatedAt: 'now' }); expect(await submission).toBe('sent'); });
    expect(await store.list()).toEqual([]);
  });

  it.each([408, 429, 500, 503, undefined])('keeps registration failure %s pending', async (status) => {
    vi.mocked(api.post).mockRejectedValue(status ? responseError(status) : new Error('Network Error'));
    const { result, store } = mount();
    await act(async () => { expect(await result.current.submit(input)).toBe('pending'); });
    expect(await store.list()).toEqual([expect.objectContaining({ stage: 'unregistered', status: 'pending' })]);
    expect(api.put).not.toHaveBeenCalled();
  });

  it.each([400, 401, 404, 409, 422])('marks an unregistered %s as needs-check with the server message', async (status) => {
    vi.mocked(api.post).mockRejectedValue(responseError(status));
    const { result, store } = mount();
    await act(async () => { expect(await result.current.submit(input)).toBe('needs_check'); });
    expect(await store.list()).toEqual([expect.objectContaining({ stage: 'unregistered', status: 'needs_check', message: 'サーバーのメッセージ' })]);
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => {});
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.put).not.toHaveBeenCalled();
  });

  it.each([408, 429, 500, undefined, 400, 409])('retains the registered stage on photo failure %s', async (status) => {
    vi.mocked(api.put).mockRejectedValue(status ? responseError(status) : new Error('Network Error'));
    const { result, store } = mount();
    const expected = status === 400 || status === 409 ? 'needs_check' : 'pending';
    await act(async () => { expect(await result.current.submit(input)).toBe(expected); });
    expect(await store.list()).toEqual([expect.objectContaining({ stage: 'registered', status: expected })]);
  });

  it('replays a persisted registered record on mount and accepts only its registration 409', async () => {
    const store = createShelfOfflineQueueStore();
    await store.put({ ...record, stage: 'registered' });
    vi.mocked(api.post).mockRejectedValue(responseError(409));
    mount(store);
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`/mobile-placement/shelves/${encodeURIComponent(input.shelfCodeRaw)}/photo`, input.photo, { timeout: 60_000 }));
    await waitFor(async () => expect(await store.list()).toEqual([]));
  });

  it('saves offline, prevents duplicate names, and flushes when online', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result, store } = mount();
    await act(async () => { await result.current.submit(input); await result.current.submit(input); });
    expect(result.current.records).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.records).toEqual([]));
    expect(await store.list()).toEqual([]);
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('continues past needs-check but stops at the first transient failure', async () => {
    const store = createShelfOfflineQueueStore();
    for (const id of ['a', 'b', 'c']) await store.put({ ...record, id, shelfCodeRaw: id });
    vi.mocked(api.post).mockRejectedValueOnce(responseError(409)).mockRejectedValueOnce(new Error('offline'));
    const { result } = mount(store);
    await waitFor(() => expect(result.current.records[0]?.status).toBe('needs_check'));
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(result.current.records.slice(1).map((item) => item.status)).toEqual(['pending', 'pending']);
  });

  it('retries server errors every 30 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(api.post).mockRejectedValueOnce(responseError(503));
    const { result } = mount();
    await act(async () => { await result.current.submit(input); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.records).toEqual([]);
    expect(api.put).toHaveBeenCalledTimes(1);
  });

  it('serializes submission and reconnect across a screen change', async () => {
    const store = createShelfOfflineQueueStore();
    const first = mount(store);
    let finish!: (value: { shelf: { shelfCodeRaw: string; isStructured: boolean } }) => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let submission!: ReturnType<typeof first.result.current.submit>;
    act(() => { submission = first.result.current.submit(input); });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = mount(store);
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => { finish({ shelf: { shelfCodeRaw: input.shelfCodeRaw, isStructured: true } }); await submission; });
    await waitFor(() => expect(second.result.current.records).toEqual([]));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.put).toHaveBeenCalledTimes(1);
  });
});
