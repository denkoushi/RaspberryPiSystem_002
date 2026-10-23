import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerOrderPlacement } from '../../../../api/client';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';

import { createHaizenOfflineQueueStore } from './haizenOfflineQueueStore';
import { useHaizenOfflineQueue } from './useHaizenOfflineQueue';

import type { ReactNode } from 'react';

vi.mock('../../../../api/client', () => ({ registerOrderPlacement: vi.fn() }));
const record = { clientRecordId: 'efecf674-c951-4fce-8db2-86dc1f24e718', slipKind: 'purchase_order' as const,
  number: '4501238876', shelfCode: '外-1', scannedAt: '2026-10-23T00:00:00.000Z' };
const success = { event: { id: 'event' }, branchState: { branchNo: 1 } } as Awaited<ReturnType<typeof registerOrderPlacement>>;
const responseError = (status: number) => ({ isAxiosError: true, response: { status, data: { message: 'この注文番号は購買データにありません' } } });
function mount(store = createHaizenOfflineQueueStore()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const hook = renderHook(() => useHaizenOfflineQueue(store), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  return { ...hook, store, invalidate };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.mocked(registerOrderPlacement).mockResolvedValue(success);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('haizen offline queue', () => {
  it.each([new Error('Network Error'), { isAxiosError: true, code: 'ECONNABORTED' }])('enqueues no-response failures with the same replay identity', async (error) => {
    vi.mocked(registerOrderPlacement).mockRejectedValue(error);
    const { result, store } = mount();
    await act(async () => { expect(await result.current.submit(record)).toMatchObject({ status: 'pending', pendingCount: 1 }); });
    expect(result.current.offline).toBe(true);
    expect(await store.list()).toEqual([{ ...record, status: 'pending' }]);
    expect(registerOrderPlacement).toHaveBeenCalledWith({ clientRecordId: record.clientRecordId, slipKind: record.slipKind,
      manufacturingOrderBarcodeRaw: record.number, shelfCodeRaw: record.shelfCode, placedAt: record.scannedAt }, 8000);
  });
  it('puts 404 responses in needs_check with the server message', async () => {
    vi.mocked(registerOrderPlacement).mockRejectedValue(responseError(404));
    const { result } = mount();
    await act(async () => { await result.current.submit(record); });
    expect(result.current.needsCheck).toEqual([{ ...record, status: 'needs_check', message: 'この注文番号は購買データにありません' }]);
    expect(result.current.pending).toEqual([]);
    expect(result.current.offline).toBe(false);
    await act(async () => { expect(await result.current.retake(record.clientRecordId)).toMatchObject(record); });
    expect(result.current.needsCheck).toEqual([]);
  });
  it('keeps 5xx pending without declaring a network outage', async () => {
    vi.mocked(registerOrderPlacement).mockRejectedValue(responseError(503));
    const { result } = mount();
    await act(async () => { await result.current.submit(record); });
    expect(result.current.pending).toHaveLength(1);
    expect(result.current.offline).toBe(false);
  });
  it('saves without sending offline, then flushes on online and invalidates placement queries', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { result, store, invalidate } = mount();
    await act(async () => { await result.current.submit(record); });
    expect(registerOrderPlacement).not.toHaveBeenCalled();
    expect(result.current.offline).toBe(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(result.current.pending).toHaveLength(0));
    expect(result.current.offline).toBe(false);
    expect(await store.list()).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: mobilePlacementQueryKeys.registeredShelves });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: mobilePlacementQueryKeys.orderPlacementBranchesAll });
  });
  it('flushes sequentially on mount, continues past 4xx, and stops at the first network failure', async () => {
    const store = createHaizenOfflineQueueStore();
    for (const id of ['a', 'b', 'c']) await store.put({ ...record, clientRecordId: id, status: 'pending' });
    vi.mocked(registerOrderPlacement).mockRejectedValueOnce(responseError(404)).mockRejectedValueOnce(new Error('offline'));
    const { result } = mount(store);
    await waitFor(() => expect(result.current.needsCheck).toHaveLength(1));
    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(registerOrderPlacement).toHaveBeenCalledTimes(2);
    expect(result.current.pending.map((r) => r.clientRecordId)).toEqual(['b', 'c']);
  });
  it('retries pending records every 30 seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(registerOrderPlacement).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(success);
    const { result } = mount();
    await act(async () => { await result.current.submit(record); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(result.current.pending).toEqual([]);
    expect(registerOrderPlacement).toHaveBeenCalledTimes(2);
  });
  it('flushes older records after a successful submission without delaying its result', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const store = createHaizenOfflineQueueStore();
    await store.put({ ...record, clientRecordId: 'older', status: 'pending' });
    const { result } = mount(store);
    await waitFor(() => expect(result.current.pending).toHaveLength(1));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    let finishOlder!: (value: typeof success) => void;
    vi.mocked(registerOrderPlacement).mockResolvedValueOnce(success).mockImplementationOnce(() => new Promise((resolve) => { finishOlder = resolve; }));
    await act(async () => { expect(await result.current.submit(record)).toMatchObject({ status: 'sent' }); });
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledTimes(2));
    expect(vi.mocked(registerOrderPlacement).mock.calls[1][0].clientRecordId).toBe('older');
    await act(async () => { finishOlder(success); });
    await waitFor(() => expect(result.current.pending).toEqual([]));
  });
  it('persists before sending and serializes submit with online flush', async () => {
    let finish!: (value: typeof success) => void;
    vi.mocked(registerOrderPlacement).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { result, store } = mount();
    let submission!: ReturnType<typeof result.current.submit>;
    act(() => { submission = result.current.submit(record); });
    await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledTimes(1));
    expect(await store.list()).toEqual([{ ...record, status: 'pending' }]);
    act(() => { window.dispatchEvent(new Event('online')); });
    await act(async () => { finish(success); await submission; });
    expect(registerOrderPlacement).toHaveBeenCalledTimes(1);
    expect(await store.list()).toEqual([]);
  });
});
