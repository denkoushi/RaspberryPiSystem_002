import { describe, expect, it, vi } from 'vitest';

import { createHaizenClientRecordId, createHaizenOfflineQueueStore } from './haizenOfflineQueueStore';

import type { HaizenQueueRecord } from './haizenOfflineQueueStore';

const record: HaizenQueueRecord = {
  clientRecordId: 'test', slipKind: 'purchase_order', number: '4501238876', shelfCode: '外-1',
  scannedAt: '2026-10-23T00:00:00.000Z', status: 'pending'
};

describe('haizen offline store', () => {
  it('falls back to memory, updates by ID, and removes without resurrecting records', async () => {
    const store = createHaizenOfflineQueueStore();
    expect(await store.list()).toEqual([]);
    await store.put(record);
    expect(await store.list()).toEqual([record]);
    const updated = { ...record, status: 'needs_check' as const, message: '見つかりません' };
    await store.put(updated);
    expect(await store.list()).toEqual([updated]);
    await store.remove(record.clientRecordId);
    expect(await store.list()).toEqual([]);
  });
  it('creates UUIDs even when randomUUID is unavailable', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('unavailable'); });
    try {
      const first = createHaizenClientRecordId();
      expect(first).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
      expect(createHaizenClientRecordId()).not.toBe(first);
    } finally { spy.mockRestore(); }
  });
});
