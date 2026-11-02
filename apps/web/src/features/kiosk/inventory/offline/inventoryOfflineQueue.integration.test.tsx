import { act, renderHook } from '@testing-library/react';
import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { postClientLogs, processInventoryTransaction } from '../../../../api/client';
import { useInventoryNfcQueue } from '../useInventoryNfcQueue';

import { createInventoryOfflineQueueStore, inventoryOfflineQueueStore } from './inventoryOfflineQueueStore';
import { inventoryOutboxRunner } from './inventoryOutboxRunner';
import { useInventoryOfflineQueue } from './useInventoryOfflineQueue';

import type { InventoryQueueInput, InventoryQueueRecord } from './inventoryOfflineQueueStore';

vi.mock('../../../../api/client', () => ({
  processInventoryTransaction: vi.fn(), processInventoryTouchTransaction: vi.fn(), postClientLogs: vi.fn(),
}));
const db = vi.hoisted(() => ({ getAll: vi.fn(), put: vi.fn(), delete: vi.fn(), transaction: vi.fn() }));
vi.mock('idb', () => ({ openDB: vi.fn(async () => db) }));
const input = (id: string, createdAt = '2026-11-02T00:00:00Z'): InventoryQueueInput => ({
  route: 'transaction', body: { itemTagUid: 'item', quantityTagUid: 'quantity', restock: false, idempotencyKey: id }, createdAt,
});
let records: Map<string, InventoryQueueRecord>;
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  records = new Map();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(postClientLogs).mockResolvedValue({} as never);
  let lane = Promise.resolve();
  db.transaction.mockImplementation(() => {
    const previous = lane;
    let release!: () => void;
    lane = new Promise<void>(resolve => { release = resolve; });
    return {
      store: {
        get: async (id: string) => { await previous; return records.get(id); },
        getAll: async () => { await previous; return [...records.values()]; },
        delete: async (id: string) => { await previous; records.delete(id); },
        add: async (record: InventoryQueueRecord) => { await previous; records.set(record.idempotencyKey, record); },
      },
      get done() { release(); return Promise.resolve(); },
    };
  });
  db.getAll.mockImplementation(async () => [...records.values()]);
  db.put.mockImplementation(async (_store, record: InventoryQueueRecord) => records.set(record.idempotencyKey, record));
  db.delete.mockImplementation(async (_store, id: string) => records.delete(id));
});

afterEach(() => { vi.useRealTimers(); });


function mountMovement(touch = false, restock = false) {
  const options = {
    canIssue: () => true, machineRef: { current: 'machine' }, editingRef: { current: false },
    selectMachine: vi.fn(), drainEventsRef: { current: async () => {} }, drainingRef: { current: false },
    flowRef: { current: { processing: false, restockMode: restock, restockTagUid: restock ? 'restock-tag' : null,
      selectedTag: { uid: touch ? '' : 'item', compartment: { id: 'drawer', stockQuantity: 10 } } } },
    eventQueueRef: { current: [{ uid: 'quantity', timestamp: 'now', eventId: 'scan-1',
      inventoryTag: { kind: 'QUANTITY', uid: 'quantity', quantity: 3 }, inventoryTagFromCache: true }] },
    queryClient: { invalidateQueries: vi.fn() }, mountedRef: { current: true },
    setMessage: vi.fn(), setMessageKind: vi.fn(), setPanel: vi.fn(), selectTag: vi.fn(),
    setRestockMode: vi.fn(), setQuantityError: vi.fn(), setLastTransaction: vi.fn(),
    selectionVerificationRef: { current: null }, verificationGenerationRef: { current: 0 },
    setRefreshingTag: vi.fn(), setCorrectionError: vi.fn(),
    runOperation: vi.fn(async (operation: () => Promise<boolean>, onError: (error: unknown) => Promise<void> | void) => {
      try { return await operation(); } catch (error) { await onError(error); return false; }
    }),
    mutations: { transaction: { mutateAsync: vi.fn() }, touchTransaction: { mutateAsync: vi.fn() } },
    completeMovement: vi.fn(), handleTouchError: vi.fn(),
  };
  renderHook(() => useInventoryNfcQueue(options as never));
  return options;
}


const httpError = (status?: number) => ({ isAxiosError: true,
  response: status ? { status, data: { message: '一時エラー' } } : undefined });

describe('inventory real store and runner integration', () => {
  it('reopens after an open failure, then saves and replays successfully', async () => {
    const store = createInventoryOfflineQueueStore();
    const runner = inventoryOutboxRunner(store);
    vi.mocked(openDB).mockRejectedValueOnce(new Error('open failed'));
    await expect(runner.save(input('first'))).rejects.toThrow('open failed');
    await runner.save(input('first'));
    await runner.flush();
    expect(processInventoryTransaction).toHaveBeenCalledExactlyOnceWith(input('first').body);
    expect(await store.list()).toEqual([]);
  });
  it.each([408, 429, 500, 503])('fails the head after 20 HTTP %s responses and sends the next request', async status => {
    const store = createInventoryOfflineQueueStore();
    const runner = inventoryOutboxRunner(store);
    await runner.save({ ...input('head'), display: { itemName: 'ボルト', quantity: 3, restock: false } });
    await runner.save(input('next', '2026-11-02T01:00:00Z'));
    vi.mocked(processInventoryTransaction).mockImplementation(async body => {
      if (body.idempotencyKey === 'head') throw httpError(status);
      return {} as never;
    });
    for (let n = 0; n < 19; n++) await runner.flush();
    expect(await store.list()).toEqual([
      expect.objectContaining({ idempotencyKey: 'head', status: 'pending', attempts: 19, lastAttemptAt: '2026-11-02T12:00:00.000Z' }),
      expect.objectContaining({ idempotencyKey: 'next', status: 'pending' }),
    ]);
    await runner.flush();
    await runner.flush();
    expect(await store.list()).toEqual([expect.objectContaining({ idempotencyKey: 'head', status: 'failed', attempts: 20 })]);
    expect(processInventoryTransaction).toHaveBeenLastCalledWith(input('next').body);
    expect(postClientLogs).toHaveBeenCalledOnce();
    expect(postClientLogs).toHaveBeenCalledWith(expect.objectContaining({ logs: [expect.objectContaining({
      context: expect.objectContaining({ idempotencyKey: 'head', display: { itemName: 'ボルト', quantity: 3, restock: false } }),
    })] }));
  });
  it('waits at exactly 24 hours, then fails on the next HTTP response and continues', async () => {
    const store = createInventoryOfflineQueueStore();
    const runner = inventoryOutboxRunner(store);
    await runner.save(input('head', '2026-11-01T12:00:00Z'));
    await runner.save(input('next'));
    vi.mocked(processInventoryTransaction).mockRejectedValueOnce(httpError(500)).mockRejectedValueOnce(httpError(500));
    await runner.flush();
    expect((await store.list())[0]).toMatchObject({ status: 'pending', attempts: 1 });
    vi.setSystemTime(new Date('2026-11-02T12:00:00.001Z'));
    await runner.flush();
    expect(await store.list()).toEqual([expect.objectContaining({ status: 'failed', attempts: 2, message: expect.stringContaining('24時間超過') })]);
    expect(processInventoryTransaction).toHaveBeenLastCalledWith(input('next').body);
  });
  it('keeps an old network failure pending without consuming the HTTP response budget', async () => {
    const store = createInventoryOfflineQueueStore();
    const runner = inventoryOutboxRunner(store);
    await runner.save(input('head', '2026-10-01T00:00:00Z'));
    await runner.save(input('next'));
    vi.mocked(processInventoryTransaction).mockRejectedValue(httpError());
    for (let n = 0; n < 21; n++) await runner.flush();
    expect((await store.list()).map(record => [record.status, record.attempts])).toEqual([['pending', undefined], ['pending', undefined]]);
    expect(processInventoryTransaction).toHaveBeenCalledTimes(21);
    expect(postClientLogs).not.toHaveBeenCalled();
  });
  it('appends a new NFC issue behind a pending restock even during an active flush', async () => {
    const runner = inventoryOutboxRunner();
    const restock = input('restock');
    restock.body.restock = true;
    await runner.save(restock);
    let finish!: () => void;
    vi.mocked(processInventoryTransaction).mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({} as never);
    }));
    const flushing = runner.flush();
    // Wait for the first send without advancing the replay interval.
    for (let n = 0; n < 30 && !finish; n++) await Promise.resolve();
    expect(finish).toBeDefined();
    const options = mountMovement();
    await act(async () => { await options.drainEventsRef.current(); });
    expect(options.mutations.transaction.mutateAsync).not.toHaveBeenCalled();
    expect((await inventoryOfflineQueueStore.list()).map(record => record.idempotencyKey)).toEqual(['restock', 'nfc-scan-1']);
    await act(async () => { finish(); await flushing; });
    expect(vi.mocked(processInventoryTransaction).mock.calls.map(([body]) => body.idempotencyKey)).toEqual(['restock', 'nfc-scan-1']);
    expect(await inventoryOfflineQueueStore.list()).toEqual([]);
  });
  it('preserves the current operation prompt after the last pending request is acknowledged', async () => {
    const runner = inventoryOutboxRunner();
    const setMessage = vi.fn();
    const setMessageKind = vi.fn();
    renderHook(() => useInventoryOfflineQueue(setMessage, setMessageKind));
    await act(async () => { await runner.save(input('only')); });
    expect(setMessage).toHaveBeenCalledWith('未送信 1 件');
    setMessage('数量NFCタグを読み取ってください');
    setMessageKind('info');
    await act(async () => { await runner.flush(); });
    expect(setMessage).toHaveBeenLastCalledWith('数量NFCタグを読み取ってください');
    expect(setMessageKind).toHaveBeenLastCalledWith('info');
  });
  it('shows the failed item, quantity and reason and reports once even if logging fails', async () => {
    const runner = inventoryOutboxRunner();
    const setMessage = vi.fn();
    const setMessageKind = vi.fn();
    renderHook(() => useInventoryOfflineQueue(setMessage, setMessageKind));
    await act(async () => { await runner.save({ ...input('bad'), display: { itemName: 'ボルト', quantity: 3, restock: false } }); });
    vi.mocked(processInventoryTransaction).mockRejectedValue(httpError(409));
    vi.mocked(postClientLogs).mockRejectedValue(new Error('logging unavailable'));
    await act(async () => { await runner.flush(); await runner.flush(); });
    expect(setMessage).toHaveBeenLastCalledWith('ボルト 3 払出失敗: 一時エラー');
    expect(setMessageKind).toHaveBeenLastCalledWith('error');
    expect(postClientLogs).toHaveBeenCalledOnce();
  });
});
