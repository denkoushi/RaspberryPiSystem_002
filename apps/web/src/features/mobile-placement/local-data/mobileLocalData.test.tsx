import { packPurchase, packSchedule } from '@raspi-system/slip-match-core';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../api/http', () => ({ api: { get: vi.fn().mockRejectedValue(new Error('offline')) } }));

import { api } from '../../../api/http';
import { canUseMobileNetwork, mobileRequest, resetMobileConnectivityForTests } from '../connectivity';
import { registerSyncJob, resetSyncSchedulerForTests, start, stop } from '../sync/syncScheduler';

import { lookupPurchaseLocalFirst, verifyLocalFirst } from './localFirstLookup';
import { createMobileLocalDataStore, mobileLocalDataStore } from './mobileLocalDataStore';
import * as mobileLocalDataSync from './mobileLocalDataSync';
import { createMobileDataSync, mobileDataApi } from './mobileLocalDataSync';
import { MobileOfflineChip } from './MobileOfflineChip';
import { useMobileLocalData } from './useMobileLocalData';

import type { PurchaseSnapshot, ScheduleSnapshot } from '@raspi-system/slip-match-core';

const date = '2026-10-27T00:00:00Z';
const row = { purchaseOrderNo: '1234567890', seiban: 'FS1', purchasePartName: '品名', masterPartName: 'マスタ', machineName: '機種',
  purchasePartCodeRaw: 'MD1(A)-001', purchasePartCodeNormalized: 'MD1-001', purchasePartCodeMatchKey: 'MD1', acceptedQuantity: 2, plannedStartDate: '2026-11-01' };
const purchase: PurchaseSnapshot = { version: 'p1', dataUpdatedAt: date, rows: [packPurchase(row)] };
const schedule: ScheduleSnapshot = { version: 's1', dataUpdatedAt: date, rows: [packSchedule({ rowId: 'r', fseiban: 'FS1', productNo: 'T1', fhincd: 'MD1', fhinmei: '品名', fsigencd: 'M', fkojun: 1 })], knownFseibans: ['FS1', 'FSNOPART'] };
const input = { transferOrderBarcodeRaw: 'T1', actualOrderBarcodeRaw: row.purchaseOrderNo, actualFseibanRaw: '' };
const versions = { purchase: { version: 'p1', dataUpdatedAt: date }, schedule: { version: 's1', dataUpdatedAt: date } };
beforeEach(() => {
  vi.mocked(api.get).mockReset().mockRejectedValue(new Error('offline'));
  window.dispatchEvent(new Event('online'));
});
afterEach(() => { resetSyncSchedulerForTests(); resetMobileConnectivityForTests(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('mobile local-first data', () => {
  it.each(['purchase', 'schedule'] as const)('downloads slow %s snapshots with matching 180-second deadlines', async (kind) => {
    vi.useFakeTimers();
    const snapshot = kind === 'purchase' ? purchase : schedule;
    vi.mocked(api.get).mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve({ status: 200, data: snapshot }), 179_000);
    }));
    const download = mobileDataApi[kind]('old');
    await vi.dynamicImportSettled();
    await vi.advanceTimersByTimeAsync(3001);
    expect(canUseMobileNetwork()).toBe(true);
    expect(api.get).toHaveBeenCalledWith(`/kiosk/mobile-local-data/${kind}`, expect.objectContaining({
      timeout: 180_000, kioskTelemetry: 'background', params: { version: 'old' }
    }));
    await vi.advanceTimersByTimeAsync(175_999);
    await expect(download).resolves.toEqual(snapshot);
    expect(canUseMobileNetwork()).toBe(true);
  });

  it('syncs again after reachability recovers without an online event', async () => {
    vi.useFakeTimers();
    const sync = vi.spyOn(mobileLocalDataSync, 'syncMobileLocalData').mockResolvedValue(undefined);
    vi.mocked(api.get).mockResolvedValue({ status: 200 });
    registerSyncJob({ name: 'local-data', run: () => mobileLocalDataSync.syncMobileLocalData() });
    start();
    const { result, unmount } = renderHook(() => useMobileLocalData('purchase'));
    await act(async () => {});
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () => { await mobileRequest(() => Promise.reject(new Error('network'))).catch(() => {}); });
    expect(result.current.offline).toBe(true);
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(result.current.offline).toBe(false);
    expect(sync).toHaveBeenCalledTimes(2);
    unmount(); stop();
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('does not probe the server over mobile data while unreachable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { onLine: true, connection: Object.assign(new EventTarget(), { type: 'cellular' }) });
    vi.mocked(api.get).mockResolvedValue({ status: 200 });
    await mobileRequest(() => Promise.reject(new Error('network'))).catch(() => {});
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.get).not.toHaveBeenCalled();
    expect(canUseMobileNetwork()).toBe(false);
  });

  it('replaces all old rows, keeps wire ordering, and distinguishes missing data from missing order', async () => {
    const store = createMobileLocalDataStore();
    expect(await store.lookupPurchase(row.purchaseOrderNo)).toBeNull();
    await store.replace({ purchase, schedule });
    expect((await store.lookupPurchase(row.purchaseOrderNo))?.rows[0]).toMatchObject(row);
    expect((await store.lookupPurchase('missing'))?.rows).toEqual([]);
    await store.replace({ purchase: { ...purchase, version: 'p2', rows: [packPurchase({ ...row, purchaseOrderNo: '0000000001' })] } });
    expect((await store.lookupPurchase(row.purchaseOrderNo))?.rows).toEqual([]);
    expect((await store.versions()).schedule?.version).toBe('s1');
  });
  it('does not publish any new version if building a memory replacement fails', async () => {
    const store = createMobileLocalDataStore(); await store.replace({ purchase, schedule });
    const invalid = { ...schedule, version: 's2', get rows(): ScheduleSnapshot['rows'] { throw new Error('allocation failed'); } };
    await expect(store.replace({ purchase: { ...purchase, version: 'p2' }, schedule: invalid })).rejects.toThrow('allocation');
    expect(await store.versions()).toEqual(versions);
    expect((await store.lookupPurchase(row.purchaseOrderNo))?.rows[0]).toMatchObject(row);
    expect(await store.verify(input)).toMatchObject({ ok: true });
    expect(await store.snapNative(['FSNOPART'], '')).toMatchObject({ fseiban: 'FSNOPART' });
    await store.replace({ purchase });
    expect((await store.lookupPurchase(row.purchaseOrderNo))?.rows[0]).toMatchObject(row);
  });
  it('keeps memory rows and metadata together if preparing version metadata fails', async () => {
    const store = createMobileLocalDataStore(); await store.replace({ purchase, schedule });
    const invalid = { ...schedule, get version(): string { throw new Error('metadata failed'); } };
    await expect(store.replace({ purchase: { ...purchase, version: 'p2', rows: [] }, schedule: invalid })).rejects.toThrow('metadata');
    expect(await store.versions()).toEqual(versions);
    expect((await store.lookupPurchase(row.purchaseOrderNo))?.rows[0]).toMatchObject(row);
    expect(await store.verify(input)).toMatchObject({ ok: true });
  });
  it('uses local purchases first, uses server on first launch, and retains missing orders locally online', async () => {
    const store = createMobileLocalDataStore(); const server = vi.fn().mockResolvedValue({ purchaseOrderNo: row.purchaseOrderNo, rows: [row] });
    await lookupPurchaseLocalFirst(row.purchaseOrderNo, server, store, true); expect(server).toHaveBeenCalledTimes(1);
    await store.replace({ purchase }); server.mockClear();
    expect((await lookupPurchaseLocalFirst(row.purchaseOrderNo, server, store, true)).rows[0]).toMatchObject(row);
    expect(server).not.toHaveBeenCalled();
    expect((await lookupPurchaseLocalFirst('missing', server, store, false)).rows).toEqual([]);
    expect(server).not.toHaveBeenCalled();
    await lookupPurchaseLocalFirst('missing', server, store, true); expect(server).not.toHaveBeenCalled();
    server.mockRejectedValue(new Error('connection lost'));
    expect((await lookupPurchaseLocalFirst('missing', server, store, true)).rows).toEqual([]);
  });
  it('fails immediately on first launch when synchronization is forbidden', async () => {
    vi.stubGlobal('navigator', { onLine: true, connection: { type: 'cellular' } });
    const store = createMobileLocalDataStore();
    const server = vi.fn();
    await expect(lookupPurchaseLocalFirst('missing', server, store)).rejects.toThrow('Mobile local data unavailable offline');
    await expect(verifyLocalFirst(input, server, store)).rejects.toThrow('Mobile local data unavailable offline');
    expect(server).not.toHaveBeenCalled();
  });
  it('verifies on the device, including mismatch, and only falls back if a dataset is absent', async () => {
    const store = createMobileLocalDataStore(); const server = vi.fn().mockResolvedValue({ ok: false, reason: 'order_not_found' });
    await verifyLocalFirst(input, server, store); expect(server).toHaveBeenCalledTimes(1);
    await store.replace({ purchase, schedule }); server.mockClear();
    expect(await verifyLocalFirst(input, server, store)).toMatchObject({ ok: true, actualResolvedBy: 'purchaseOrder' });
    expect(await verifyLocalFirst({ ...input, actualPartBarcodeRaw: 'WRONG' }, server, store)).toMatchObject({ ok: false, reason: 'different_part' });
    expect(server).not.toHaveBeenCalled();
    expect(await store.snapNative(['FSNOPART'], '')).toMatchObject({ fseiban: 'FSNOPART', fseibanMatch: 'exact' });
  });
  it('only downloads changed versions and shares in-flight synchronization', async () => {
    const store = createMobileLocalDataStore();
    const remote = { versions: vi.fn().mockResolvedValue(versions), purchase: vi.fn().mockResolvedValue(purchase), schedule: vi.fn().mockResolvedValue(schedule) };
    const sync = createMobileDataSync(store, remote);
    await Promise.all([sync(), sync()]);
    expect(remote.versions).toHaveBeenCalledTimes(1); expect(remote.purchase).toHaveBeenCalledTimes(1);
    await sync(); expect(remote.purchase).toHaveBeenCalledTimes(1); expect(remote.schedule).toHaveBeenCalledTimes(1);
    remote.versions.mockResolvedValue({ ...versions, purchase: { ...versions.purchase, version: 'p2' } });
    remote.purchase.mockResolvedValue({ ...purchase, version: 'p2' });
    await sync(); expect(remote.purchase).toHaveBeenLastCalledWith('p1'); expect(remote.schedule).toHaveBeenCalledTimes(1);
  });
  it.each([
    ['order_not_found', { ...input, actualOrderBarcodeRaw: 'missing' }],
    ['order_not_found', { ...input, actualOrderBarcodeRaw: '', actualFseibanRaw: 'missing' }],
    ['order_not_found', { ...input, actualOrderBarcodeRaw: '0000000000' }],
    ['transfer_not_found', { ...input, transferOrderBarcodeRaw: 'missing' }]
  ] as const)('retains local %s without requesting the server online', async (reason, missingInput) => {
    const store = createMobileLocalDataStore(); await store.replace({ purchase, schedule });
    const local = await store.verify(missingInput);
    expect(local).toMatchObject({ ok: false, reason });
    const server = vi.fn().mockResolvedValue({ ok: true, reason: 'match' });
    expect(await verifyLocalFirst(missingInput, server, store, false)).toEqual(local);
    expect(server).not.toHaveBeenCalled();
    expect(await verifyLocalFirst(missingInput, server, store, true)).toEqual(local);
    server.mockResolvedValue({ ok: false, reason: 'different_part' });
    expect(await verifyLocalFirst(missingInput, server, store, true)).toEqual(local);
    expect(server).not.toHaveBeenCalled();
    server.mockRejectedValue(new Error('offline'));
    expect(await verifyLocalFirst(missingInput, server, store, true)).toEqual(local);
  });
  it('keeps old data during download and after download failure or a version race', async () => {
    const store = createMobileLocalDataStore(); await store.replace({ purchase, schedule });
    let reject!: (reason: Error) => void;
    const remote = { versions: vi.fn().mockResolvedValue({ ...versions, purchase: { ...versions.purchase, version: 'p2' } }),
      purchase: vi.fn(() => new Promise<PurchaseSnapshot>((_, r) => { reject = r; })), schedule: vi.fn().mockResolvedValue(schedule) };
    const sync = createMobileDataSync(store, remote); const running = sync();
    await waitFor(() => expect(remote.purchase).toHaveBeenCalled());
    expect((await store.lookupPurchase(row.purchaseOrderNo))?.rows[0]).toMatchObject(row);
    reject(new Error('network')); await expect(running).rejects.toThrow('network');
    remote.versions.mockResolvedValue({ ...versions, purchase: { ...versions.purchase, version: 'p4' } });
    remote.purchase.mockResolvedValue({ ...purchase, version: 'p3' });
    await expect(sync()).rejects.toThrow('changed'); expect(await store.versions()).toEqual(versions);
  });
  it('backs off failed downloads from 30 minutes to 6 hours, including reconnect attempts, and resets on success', async () => {
    vi.useFakeTimers();
    const store = createMobileLocalDataStore(); await store.replace({ purchase, schedule });
    const remote = { versions: vi.fn().mockResolvedValue({ ...versions, purchase: { ...versions.purchase, version: 'p2' } }),
      purchase: vi.fn().mockRejectedValue(new Error('network')), schedule: vi.fn() };
    const sync = createMobileDataSync(store, remote);
    await expect(sync()).rejects.toThrow('network');
    for (const minutes of [30, 60, 120, 240, 360, 360]) {
      const attempts = remote.purchase.mock.calls.length;
      await sync(); // The online event uses the same sync entry point.
      await vi.advanceTimersByTimeAsync(minutes * 60_000 - 1);
      await sync(); expect(remote.purchase).toHaveBeenCalledTimes(attempts);
      await vi.advanceTimersByTimeAsync(1);
      await expect(sync()).rejects.toThrow('network');
      expect(remote.purchase).toHaveBeenCalledTimes(attempts + 1);
    }
    // A new server version bypasses the current six-hour wait.
    remote.versions.mockResolvedValue({ ...versions, purchase: { ...versions.purchase, version: 'p3' } });
    remote.purchase.mockResolvedValue({ ...purchase, version: 'p3' });
    await sync(); expect((await store.versions()).purchase?.version).toBe('p3');
    remote.versions.mockResolvedValue({ ...versions, purchase: { ...versions.purchase, version: 'p4' } });
    remote.purchase.mockRejectedValue(new Error('network'));
    await expect(sync()).rejects.toThrow('network');
    const attempts = remote.purchase.mock.calls.length;
    await sync(); expect(remote.purchase).toHaveBeenCalledTimes(attempts);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    await expect(sync()).rejects.toThrow('network');
    expect(remote.purchase).toHaveBeenCalledTimes(attempts + 1);
  });
  it('backs off after version-check failure without extending the wait on reconnect', async () => {
    vi.useFakeTimers();
    const store = createMobileLocalDataStore();
    const remote = { versions: vi.fn().mockRejectedValue(new Error('network')),
      purchase: vi.fn().mockResolvedValue(purchase), schedule: vi.fn().mockResolvedValue(schedule) };
    const sync = createMobileDataSync(store, remote);
    await expect(sync()).rejects.toThrow('network');
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await expect(sync()).rejects.toThrow('network');
    remote.versions.mockResolvedValue(versions);
    await sync(); expect(remote.purchase).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    await sync(); expect(remote.purchase).toHaveBeenCalledTimes(1);
  });
  it('shows the date only while offline', () => {
    const { rerender } = render(<MobileOfflineChip offline updatedAt={date} />);
    expect(screen.getByText('圏外 10/27')).toBeInTheDocument();
    rerender(<MobileOfflineChip offline={false} updatedAt={date} />); expect(screen.queryByText(/圏外/)).not.toBeInTheDocument();
    rerender(<MobileOfflineChip offline />); expect(screen.getByText('圏外')).toBeInTheDocument();
  });
  it('only reads versions and refreshes when a scheduler job finishes', async () => {
    const sync = vi.spyOn(mobileLocalDataSync, 'syncMobileLocalData').mockResolvedValue(undefined);
    const read = vi.spyOn(mobileLocalDataStore, 'versions').mockResolvedValue({});
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useMobileLocalData('purchase'));
    await act(async () => {});
    expect(sync).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValue(versions);
    registerSyncJob({ name: 'local-data', run: sync });
    await act(async () => { start(); });
    expect(result.current.updatedAt).toBe(date);
    unmount();
    const reads = read.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000); });
    expect(sync).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenCalledTimes(reads);
  });
});
