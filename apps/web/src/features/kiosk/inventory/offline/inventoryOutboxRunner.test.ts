import { beforeEach, describe, expect, it, vi } from 'vitest';

import { postClientLogs, processInventoryTouchTransaction, processInventoryTransaction } from '../../../../api/client';

import { inventoryOutboxRunner, isRetryableInventoryError } from './inventoryOutboxRunner';

import type { InventoryOfflineQueueStore, InventoryQueueRecord } from './inventoryOfflineQueueStore';

vi.mock('../../../../api/client', () => ({ postClientLogs: vi.fn(), processInventoryTouchTransaction: vi.fn(), processInventoryTransaction: vi.fn() }));
const httpError = (status?: number) => ({ isAxiosError: true, response: status ? { status, data: { message: 'invalid' } } : undefined });
const record = (id: string): InventoryQueueRecord => ({ route: 'transaction',
  body: { itemTagUid: 'item', quantityTagUid: 'quantity', restock: false, idempotencyKey: id },
  idempotencyKey: id, createdAt: `2026-11-02T00:00:0${id}Z`, status: 'pending' });
function mount(initial: InventoryQueueRecord[] = []) {
  const records = new Map(initial.map(item => [item.idempotencyKey, item]));
  const store: InventoryOfflineQueueStore = {
    list: vi.fn(async () => [...records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
    add: vi.fn(),
    recordAttempt: vi.fn(async item => {
      const updated = { ...item, attempts: (item.attempts ?? 0) + 1, lastAttemptAt: new Date().toISOString() };
      records.set(item.idempotencyKey, updated);
      return updated;
    }),
    prune: vi.fn(),
    fail: vi.fn(async (item, message) => { records.set(item.idempotencyKey, { ...item, status: 'failed', message }); }),
    remove: vi.fn(async id => { records.delete(id); }),
  };
  const runner = inventoryOutboxRunner(store);
  return { runner, store };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-02T12:00:00Z'));
  vi.mocked(postClientLogs).mockResolvedValue({} as never);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

describe('inventory outbox runner', () => {
  it.each([undefined, 408, 429, 500, 503])('keeps retryable %s failures pending and stops the FIFO drain', async status => {
    vi.mocked(processInventoryTransaction).mockRejectedValue(httpError(status));
    const { runner, store } = mount([record('2'), record('1')]);
    await runner.flush();
    expect(processInventoryTransaction).toHaveBeenCalledExactlyOnceWith(record('1').body);
    expect(await store.list()).toHaveLength(2);
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.fail).not.toHaveBeenCalled();
  });
  it.each([400, 401, 404, 409, 422])('retains permanent %s failures, skips them on future drains, and continues', async status => {
    vi.mocked(processInventoryTransaction).mockRejectedValueOnce(httpError(status)).mockResolvedValue({} as never);
    const { runner, store } = mount([record('1'), record('2')]);
    const listener = vi.fn();
    runner.subscribe(listener);
    await runner.flush();
    await runner.flush();
    expect(await store.list()).toEqual([{ ...record('1'), status: 'failed', message: 'invalid' }]);
    expect(processInventoryTransaction).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('Inventory offline request failed', { ...record('1'), status: 'failed', message: 'invalid' });
    expect(listener).toHaveBeenLastCalledWith(await store.list());
  });
  it('replays both saved routes with identical keys, removing after success and notifying listeners', async () => {
    const touch: InventoryQueueRecord = { ...record('2'), route: 'touchTransaction',
      body: { compartmentId: 'drawer', quantity: 3, restock: true, idempotencyKey: '2' } };
    const { runner, store } = mount([touch, record('1')]);
    const sent = vi.fn();
    runner.onSent(sent);
    await runner.flush();
    expect(processInventoryTransaction).toHaveBeenCalledWith(record('1').body);
    expect(processInventoryTouchTransaction).toHaveBeenCalledWith(touch.body);
    expect(await store.list()).toEqual([]);
    expect(sent).toHaveBeenCalledTimes(2);
  });
  it('shares one drain between overlapping flushes and never deletes before the response', async () => {
    let finish!: () => void;
    vi.mocked(processInventoryTransaction).mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({} as never); }));
    const { runner, store } = mount([record('1')]);
    const first = runner.flush();
    const second = inventoryOutboxRunner(store).flush();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(processInventoryTransaction).toHaveBeenCalledTimes(1));
    expect(store.remove).not.toHaveBeenCalled();
    finish();
    await Promise.all([first, second]);
    expect(store.remove).toHaveBeenCalledExactlyOnceWith('1');
  });
  it('does not send offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { runner, store } = mount([record('1')]);
    await runner.flush();
    expect(processInventoryTransaction).not.toHaveBeenCalled();
    expect(store.prune).toHaveBeenCalledOnce();
    expect(await store.list()).toHaveLength(1);
  });
  it('does not classify programming errors or nonretryable HTTP statuses as network failures', () => {
    expect(isRetryableInventoryError(new Error('bug'))).toBe(false);
    expect(isRetryableInventoryError(httpError(400))).toBe(false);
  });
});
