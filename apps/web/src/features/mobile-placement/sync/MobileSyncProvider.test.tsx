import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { registerOrderPlacement } from '../../../api/client';
import { resetMobileConnectivityForTests } from '../connectivity';
import { haizenOfflineQueueStore } from '../haizen/offline/haizenOfflineQueueStore';
import { useHaizenOfflineQueue } from '../haizen/offline/useHaizenOfflineQueue';
import { syncMobileLocalData } from '../local-data/mobileLocalDataSync';
import { useMobileLocalData } from '../local-data/useMobileLocalData';
import { mobilePlacementQueryKeys } from '../mobilePlacementQueryKeys';

import { MobileSyncProvider } from './MobileSyncProvider';
import { importNativeLocalData, pushClientKeyToNative } from './nativeLocalDataImport';
import { resetSyncSchedulerForTests } from './syncScheduler';

vi.mock('../../../api/client', () => ({ registerOrderPlacement: vi.fn() }));
vi.mock('../local-data/mobileLocalDataSync', () => ({ syncMobileLocalData: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./nativeLocalDataImport', () => ({ importNativeLocalData: vi.fn().mockResolvedValue(undefined), pushClientKeyToNative: vi.fn() }));
const record = { clientRecordId: 'provider-record', slipKind: 'purchase_order' as const, number: '4501238876',
  shelfCode: '外-1', scannedAt: '2026-10-23T00:00:00.000Z', status: 'pending' as const };
let connection: EventTarget & { type: string };
beforeEach(() => {
  connection = Object.assign(new EventTarget(), { type: 'cellular' });
  vi.stubGlobal('navigator', { onLine: true, connection });
  vi.mocked(registerOrderPlacement).mockResolvedValue({ event: { id: 'event' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
});
afterEach(async () => {
  resetSyncSchedulerForTests(); resetMobileConnectivityForTests();
  for (const item of await haizenOfflineQueueStore.list()) await haizenOfflineQueueStore.remove(item.clientRecordId);
  vi.clearAllMocks(); vi.unstubAllGlobals();
});

it('sends exactly once on cellular -> wifi with only the provider mounted, including StrictMode', async () => {
  await haizenOfflineQueueStore.put(record);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const persist = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('navigator', { onLine: true, connection, storage: { persist } });
  const { unmount } = render(<QueryClientProvider client={client}><StrictMode><MobileSyncProvider><div>別の画面</div></MobileSyncProvider></StrictMode></QueryClientProvider>);
  await act(async () => {});
  expect(registerOrderPlacement).not.toHaveBeenCalled();
  expect(persist).toHaveBeenCalledTimes(1);
  await act(async () => { connection.type = 'wifi'; connection.dispatchEvent(new Event('change')); connection.dispatchEvent(new Event('change')); });
  await waitFor(async () => expect(await haizenOfflineQueueStore.list()).toEqual([]));
  expect(registerOrderPlacement).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: mobilePlacementQueryKeys.registeredShelves });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: mobilePlacementQueryKeys.orderPlacementBranchesAll });
  unmount();
});

it('reports offline on cellular for both chip callers and persists submit without sending', async () => {
  const { result } = renderHook(() => ({ queue: useHaizenOfflineQueue(), data: useMobileLocalData('purchase') }));
  await act(async () => { expect(await result.current.queue.submit(record)).toMatchObject({ status: 'pending', pendingCount: 1 }); });
  expect(result.current.queue.offline).toBe(true);
  expect(result.current.data.offline).toBe(true);
  expect(registerOrderPlacement).not.toHaveBeenCalled();
});

it('shares claimed submissions and preserves move order after the submitting hook unmounts', async () => {
  connection.type = 'wifi';
  const client = new QueryClient();
  const provider = render(<QueryClientProvider client={client}><MobileSyncProvider><div /></MobileSyncProvider></QueryClientProvider>);
  await act(async () => {});
  let finish!: (value: Awaited<ReturnType<typeof registerOrderPlacement>>) => void;
  vi.mocked(registerOrderPlacement).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const first = renderHook(() => useHaizenOfflineQueue());
  let firstSend!: ReturnType<typeof first.result.current.submit>;
  act(() => { firstSend = first.result.current.submit({ ...record, branchNo: 2 }); });
  await waitFor(() => expect(registerOrderPlacement).toHaveBeenCalledTimes(1));
  first.unmount();
  const second = renderHook(() => useHaizenOfflineQueue());
  let secondSend!: ReturnType<typeof second.result.current.submit>;
  act(() => { secondSend = second.result.current.submit({ ...record, clientRecordId: 'later', branchNo: 2, shelfCode: '次の棚', scannedAt: '2026-10-23T01:00:00.000Z' }); });
  await waitFor(async () => expect(await haizenOfflineQueueStore.list()).toHaveLength(2));
  await act(async () => {
    connection.dispatchEvent(new Event('change'));
    finish({ event: { id: 'first' } } as Awaited<ReturnType<typeof registerOrderPlacement>>);
    expect(await firstSend).toMatchObject({ status: 'sent' });
    expect(await secondSend).toMatchObject({ status: 'sent' });
  });
  expect(vi.mocked(registerOrderPlacement).mock.calls.map(([payload]) => [payload.clientRecordId, payload.shelfCodeRaw])).toEqual([
    [record.clientRecordId, record.shelfCode], ['later', '次の棚']
  ]);
  expect(await haizenOfflineQueueStore.list()).toEqual([]);
  second.unmount(); provider.unmount();
});

it('hands off the key and imports on mount and foreground, then removes the listener', async () => {
  const provider = render(<QueryClientProvider client={new QueryClient()}><MobileSyncProvider><div /></MobileSyncProvider></QueryClientProvider>);
  await act(async () => {});
  expect(pushClientKeyToNative).toHaveBeenCalledTimes(1);
  expect(importNativeLocalData).toHaveBeenCalledTimes(1);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(importNativeLocalData).toHaveBeenCalledTimes(1);
  visibility.mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(pushClientKeyToNative).toHaveBeenCalledTimes(2);
  expect(importNativeLocalData).toHaveBeenCalledTimes(2);
  provider.unmount();
  document.dispatchEvent(new Event('visibilitychange'));
  expect(importNativeLocalData).toHaveBeenCalledTimes(2);
  visibility.mockRestore();
});

it('sends a placement while a long local-data download is still running', async () => {
  connection.type = 'wifi';
  vi.mocked(syncMobileLocalData).mockImplementationOnce(() => new Promise<void>(() => {}));
  const provider = render(<QueryClientProvider client={new QueryClient()}><MobileSyncProvider><div /></MobileSyncProvider></QueryClientProvider>);
  await waitFor(() => expect(syncMobileLocalData).toHaveBeenCalled());
  const { result, unmount } = renderHook(() => useHaizenOfflineQueue());
  await act(async () => { expect(await result.current.submit(record)).toMatchObject({ status: 'sent' }); });
  unmount(); provider.unmount();
});
