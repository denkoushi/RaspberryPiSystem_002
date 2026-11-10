import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createInventoryOfflineQueueStore } from './inventoryOfflineQueueStore';

import type { InventoryQueueInput, InventoryQueueRecord } from './inventoryOfflineQueueStore';

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

describe('inventory IndexedDB queue', () => {
  it('persists complete requests across store instances and lists oldest first', async () => {
    const store = createInventoryOfflineQueueStore();
    await store.add(input('newer', '2026-11-02T01:00:00Z'));
    await store.add(input('older'));
    expect(await createInventoryOfflineQueueStore().list()).toEqual([
      { ...input('older'), idempotencyKey: 'older', status: 'pending' },
      { ...input('newer', '2026-11-02T01:00:00Z'), idempotencyKey: 'newer', status: 'pending' },
    ]);
    expect(db.transaction).toHaveBeenCalledWith('requests', 'readwrite');
  });
  it('atomically deduplicates concurrent saves without replacing the original request', async () => {
    await Promise.all([
      createInventoryOfflineQueueStore().add(input('same')),
      createInventoryOfflineQueueStore().add({ ...input('same'), body: { ...input('same').body, restock: true } }),
    ]);
    expect([...records.values()]).toEqual([{ ...input('same'), idempotencyKey: 'same', status: 'pending' }]);
  });
  it('enforces the 500 pending cap across instances, excluding failed records', async () => {
    const store = createInventoryOfflineQueueStore();
    for (let n = 0; n < 500; n++) await store.add(input(String(n)));
    const [first] = await store.list();
    await store.fail(first, 'invalid');
    const results = await Promise.allSettled([store.add(input('last')), createInventoryOfflineQueueStore().add(input('overflow'))]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await store.list()).toHaveLength(501);
    await expect(store.add(input('last'))).resolves.toBeUndefined();
    await expect(store.add(input('overflow'))).rejects.toThrow('上限');
  });
  it('keeps permanent failures with the request and removes only acknowledged records', async () => {
    const store = createInventoryOfflineQueueStore();
    await store.add(input('bad'));
    await store.fail((await store.list())[0], '登録が変わりました');
    expect(await store.list()).toEqual([{ ...input('bad'), idempotencyKey: 'bad', status: 'failed', message: '登録が変わりました' }]);
    await store.remove('bad');
    expect(await createInventoryOfflineQueueStore().list()).toEqual([]);
  });
  it.each(['add', 'prune'] as const)('prunes failed records by age and keeps the newest 50 during %s', async action => {
    const store = createInventoryOfflineQueueStore();
    const putFailed = (id: string, createdAt: string) => records.set(id, {
      ...input(id, createdAt), idempotencyKey: id, status: 'failed', message: 'invalid',
    });
    for (let n = 0; n < 52; n++) putFailed(`failed-${n}`, new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString());
    putFailed('expired', '2026-10-26T11:59:59Z');
    // Old pending records must survive retention cleanup.
    records.set('pending', { ...input('pending', '2026-10-01T00:00:00Z'), idempotencyKey: 'pending', status: 'pending' });
    if (action === 'add') await store.add(input('new'));
    else await store.prune();
    const remaining = await store.list();
    expect(remaining.filter(record => record.status === 'failed')).toHaveLength(50);
    expect(records.has('failed-0')).toBe(false);
    expect(records.has('failed-1')).toBe(false);
    expect(records.has('failed-51')).toBe(true);
    expect(records.has('expired')).toBe(false);
    expect(records.has('pending')).toBe(true);
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
    await store.prune();
    expect((await store.list()).every(record => record.status === 'pending')).toBe(true);
  });
  it('retains failed records exactly seven days old until they exceed the age limit', async () => {
    const store = createInventoryOfflineQueueStore();
    records.set('boundary', { ...input('boundary', '2026-10-26T12:00:00Z'), idempotencyKey: 'boundary', status: 'failed' });
    await store.prune();
    expect(records.has('boundary')).toBe(true);
    vi.setSystemTime(new Date('2026-11-02T12:00:00.001Z'));
    await store.prune();
    expect(records.has('boundary')).toBe(false);
  });
  it('does not resurrect a removal when a prior list completes late', async () => {
    const store = createInventoryOfflineQueueStore();
    await store.add(input('old'));
    let finishRead!: (value: InventoryQueueRecord[]) => void;
    const snapshot = await store.list();
    db.getAll.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    const listing = store.list();
    await Promise.resolve();
    expect(finishRead).toBeDefined();
    await store.remove('old');
    await store.add(input('new'));
    finishRead(snapshot);
    await listing;
    expect((await store.list()).map(record => record.idempotencyKey)).toEqual(['new']);
  });
  it('propagates IndexedDB failures rather than reporting a volatile save as durable', async () => {
    db.transaction.mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(createInventoryOfflineQueueStore().add(input('lost'))).rejects.toThrow('quota');
    expect(records.size).toBe(0);
  });
});
