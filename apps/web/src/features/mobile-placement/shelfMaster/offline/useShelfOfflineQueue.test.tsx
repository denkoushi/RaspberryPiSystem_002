import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postMobilePlacementShelfRegister, putMobilePlacementShelfPhoto } from '../../../../api/client';

import { createShelfOfflineQueueStore } from './shelfOfflineQueueStore';
import { useShelfOfflineQueue } from './useShelfOfflineQueue';

import type { ShelfQueueRecord } from './shelfOfflineQueueStore';
import type { ReactNode } from 'react';

vi.mock('../../../../api/client', () => ({ postMobilePlacementShelfRegister: vi.fn(), putMobilePlacementShelfPhoto: vi.fn() }));
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
  vi.mocked(postMobilePlacementShelfRegister).mockResolvedValue({ shelf: { shelfCodeRaw: input.shelfCodeRaw, isStructured: true } });
  vi.mocked(putMobilePlacementShelfPhoto).mockResolvedValue({ photoUpdatedAt: '2026-10-27T00:00:00Z' });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('shelf offline queue', () => {
  it('persists before registration, persists the registered stage before uploading, and removes only after upload', async () => {
    const store = createShelfOfflineQueueStore();
    vi.mocked(postMobilePlacementShelfRegister).mockImplementationOnce(async () => {
      expect(await store.list()).toEqual([expect.objectContaining({ ...input, stage: 'unregistered', status: 'pending' })]);
      return { shelf: { shelfCodeRaw: input.shelfCodeRaw, isStructured: true } };
    });
    let finish!: (value: { photoUpdatedAt: string }) => void;
    vi.mocked(putMobilePlacementShelfPhoto).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result } = mount(store);
    let submission!: ReturnType<typeof result.current.submit>;
    act(() => { submission = result.current.submit(input); });
    await waitFor(() => expect(putMobilePlacementShelfPhoto).toHaveBeenCalledTimes(1));
    expect(await store.list()).toEqual([expect.objectContaining({ ...input, stage: 'registered' })]);
    await act(async () => { finish({ photoUpdatedAt: 'now' }); expect(await submission).toBe('sent'); });
    expect(await store.list()).toEqual([]);
  });

  it.each([408, 429, 500, 503, undefined])('keeps registration failure %s pending', async (status) => {
    vi.mocked(postMobilePlacementShelfRegister).mockRejectedValue(status ? responseError(status) : new Error('Network Error'));
    const { result, store } = mount();
    await act(async () => { expect(await result.current.submit(input)).toBe('pending'); });
    expect(await store.list()).toEqual([expect.objectContaining({ stage: 'unregistered', status: 'pending' })]);
    expect(putMobilePlacementShelfPhoto).not.toHaveBeenCalled();
  });

  it.each([400, 401, 404, 409, 422])('marks an unregistered %s as needs-check with the server message', async (status) => {
    vi.mocked(postMobilePlacementShelfRegister).mockRejectedValue(responseError(status));
    const { result, store } = mount();
    await act(async () => { expect(await result.current.submit(input)).toBe('needs_check'); });
    expect(await store.list()).toEqual([expect.objectContaining({ stage: 'unregistered', status: 'needs_check', message: 'サーバーのメッセージ' })]);
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => {});
    expect(postMobilePlacementShelfRegister).toHaveBeenCalledTimes(1);
    expect(putMobilePlacementShelfPhoto).not.toHaveBeenCalled();
  });

  it.each([408, 429, 500, undefined, 400, 409])('retains the registered stage on photo failure %s', async (status) => {
    vi.mocked(putMobilePlacementShelfPhoto).mockRejectedValue(status ? responseError(status) : new Error('Network Error'));
    const { result, store } = mount();
    const expected = status === 400 || status === 409 ? 'needs_check' : 'pending';
    await act(async () => { expect(await result.current.submit(input)).toBe(expected); });
    expect(await store.list()).toEqual([expect.objectContaining({ stage: 'registered', status: expected })]);
  });

  it('replays a persisted registered record on mount and accepts only its registration 409', async () => {
    const store = createShelfOfflineQueueStore();
    await store.put({ ...record, stage: 'registered' });
    vi.mocked(postMobilePlacementShelfRegister).mockRejectedValue(responseError(409));
    mount(store);
    await waitFor(() => expect(putMobilePlacementShelfPhoto).toHaveBeenCalledWith(input.shelfCodeRaw, input.photo));
    await waitFor(async () => expect(await store.list()).toEqual([]));
  });

  it('saves offline, prevents duplicate names, and flushes when online', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result, store } = mount();
    await act(async () => { await result.current.submit(input); await result.current.submit(input); });
    expect(result.current.records).toHaveLength(1);
    expect(postMobilePlacementShelfRegister).not.toHaveBeenCalled();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(result.current.records).toEqual([]));
    expect(await store.list()).toEqual([]);
    expect(postMobilePlacementShelfRegister).toHaveBeenCalledTimes(1);
  });

  it('continues past needs-check but stops at the first transient failure', async () => {
    const store = createShelfOfflineQueueStore();
    for (const id of ['a', 'b', 'c']) await store.put({ ...record, id, shelfCodeRaw: id });
    vi.mocked(postMobilePlacementShelfRegister).mockRejectedValueOnce(responseError(409)).mockRejectedValueOnce(new Error('offline'));
    const { result } = mount(store);
    await waitFor(() => expect(result.current.records[0]?.status).toBe('needs_check'));
    expect(postMobilePlacementShelfRegister).toHaveBeenCalledTimes(2);
    expect(result.current.records.slice(1).map((item) => item.status)).toEqual(['pending', 'pending']);
  });

  it('retries every 30 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(postMobilePlacementShelfRegister).mockRejectedValueOnce(new Error('offline'));
    const { result } = mount();
    await act(async () => { await result.current.submit(input); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.records).toEqual([]);
    expect(putMobilePlacementShelfPhoto).toHaveBeenCalledTimes(1);
  });

  it('serializes submission and reconnect across a screen change', async () => {
    const store = createShelfOfflineQueueStore();
    const first = mount(store);
    let finish!: (value: { shelf: { shelfCodeRaw: string; isStructured: boolean } }) => void;
    vi.mocked(postMobilePlacementShelfRegister).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    let submission!: ReturnType<typeof first.result.current.submit>;
    act(() => { submission = first.result.current.submit(input); });
    await waitFor(() => expect(postMobilePlacementShelfRegister).toHaveBeenCalledTimes(1));
    first.unmount();
    const second = mount(store);
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => { finish({ shelf: { shelfCodeRaw: input.shelfCodeRaw, isStructured: true } }); await submission; });
    await waitFor(() => expect(second.result.current.records).toEqual([]));
    expect(postMobilePlacementShelfRegister).toHaveBeenCalledTimes(1);
    expect(putMobilePlacementShelfPhoto).toHaveBeenCalledTimes(1);
  });
});
