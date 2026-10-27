import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createShelfClientRecordId, createShelfOfflineQueueStore } from './shelfOfflineQueueStore';

import type { ShelfQueueRecord } from './shelfOfflineQueueStore';

vi.mock('idb', () => ({ openDB: vi.fn() }));
const record: ShelfQueueRecord = { id: 'test', shelfCodeRaw: '電気室', displayLabel: '上段',
  photo: { contentType: 'image/jpeg', dataBase64: '/9j/' }, createdAt: '2026-10-27T00:00:00Z', stage: 'unregistered', status: 'pending' };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shelf offline queue store', () => {
  it('falls back to memory when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const store = createShelfOfflineQueueStore();
    await store.put(record);
    expect(await store.list()).toEqual([record]);
    const updated = { ...record, stage: 'registered' as const, status: 'needs_check' as const, message: '確認' };
    await store.put(updated);
    expect(await store.list()).toEqual([updated]);
    await store.remove(record.id);
    expect(await store.list()).toEqual([]);
  });

  it('persists across store instances in a separate DB and retains loaded records if a write fails', async () => {
    vi.stubGlobal('indexedDB', {});
    const saved = new Map<string, ShelfQueueRecord>();
    const db = {
      getAll: vi.fn(async () => [...saved.values()]),
      put: vi.fn(async (_table: string, value: ShelfQueueRecord) => { saved.set(value.id, structuredClone(value)); }),
      delete: vi.fn(async (_table: string, id: string) => { saved.delete(id); })
    };
    vi.mocked(openDB).mockResolvedValue(db as never);
    const first = createShelfOfflineQueueStore();
    await first.put(record);
    expect(openDB).toHaveBeenCalledWith('shelf-offline-queue', 1, expect.any(Object));
    const reopened = createShelfOfflineQueueStore();
    expect(await reopened.list()).toEqual([record]);
    db.put.mockRejectedValueOnce(new Error('quota'));
    const second = { ...record, id: 'second' };
    await reopened.put(second);
    expect(await reopened.list()).toEqual([record, second]);
    await reopened.remove(record.id);
    expect(await reopened.list()).toEqual([second]);
  });

  it('falls back when opening IndexedDB is denied', async () => {
    vi.stubGlobal('indexedDB', {});
    vi.mocked(openDB).mockRejectedValue(new Error('denied'));
    const store = createShelfOfflineQueueStore();
    await store.put(record);
    expect(await store.list()).toEqual([record]);
  });

  it('creates distinct IDs without randomUUID', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('unavailable'); });
    const first = createShelfClientRecordId();
    expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    expect(createShelfClientRecordId()).not.toBe(first);
  });
});
