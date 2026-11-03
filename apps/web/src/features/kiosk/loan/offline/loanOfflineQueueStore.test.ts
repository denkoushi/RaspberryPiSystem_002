import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLoanOfflineQueueStore } from './loanOfflineQueueStore';

import type { LoanQueueInput, LoanQueueRecord } from './loanOfflineQueueStore';

const db = vi.hoisted(() => ({ getAll: vi.fn(), put: vi.fn(), delete: vi.fn(), transaction: vi.fn() }));
vi.mock('idb', () => ({ openDB: vi.fn(async () => db) }));
const input = (eventKey: string, readAt = '2026-11-03T09:00:00Z'): LoanQueueInput => ({
  route: 'toolBorrow', body: { itemTagUid: 'TOOL', employeeTagUid: 'EMPLOYEE', eventKey, readAt },
});
let records: Map<string, LoanQueueRecord>;
beforeEach(() => {
  vi.resetAllMocks();
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
        add: async (record: LoanQueueRecord) => { await previous; records.set(record.eventKey, record); },
      },
      get done() { release(); return Promise.resolve(); },
    };
  });
  db.getAll.mockImplementation(async () => [...records.values()]);
  db.put.mockImplementation(async (_store, record: LoanQueueRecord) => records.set(record.eventKey, record));
  db.delete.mockImplementation(async (_store, id: string) => records.delete(id));
});

describe('loan IndexedDB queue', () => {
  it('retains the full request across instances, sorted by readAt', async () => {
    const store = createLoanOfflineQueueStore();
    await store.add(input('newer', '2026-11-03T10:00:00Z'));
    await store.add(input('older'));
    expect(await createLoanOfflineQueueStore().list()).toEqual([
      { ...input('older'), eventKey: 'older', readAt: input('older').body.readAt, status: 'pending' },
      { ...input('newer', '2026-11-03T10:00:00Z'), eventKey: 'newer', readAt: '2026-11-03T10:00:00Z', status: 'pending' },
    ]);
  });
  it('deduplicates concurrent saves without replacing the original payload', async () => {
    await Promise.all([
      createLoanOfflineQueueStore().add(input('same')),
      createLoanOfflineQueueStore().add({ ...input('same'), body: { ...input('same').body, note: 'different' } }),
    ]);
    expect([...records.values()]).toEqual([{ ...input('same'), eventKey: 'same', readAt: input('same').body.readAt, status: 'pending' }]);
  });
  it('caps pending requests atomically across instances and preserves failed records', async () => {
    const store = createLoanOfflineQueueStore();
    for (let n = 0; n < 500; n++) await store.add(input(String(n)));
    const [first] = await store.list();
    await store.fail(first, 'タグ未登録');
    const results = await Promise.allSettled([store.add(input('last')), createLoanOfflineQueueStore().add(input('overflow'))]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await store.list()).toHaveLength(501);
    await store.remove(first.eventKey);
    expect((await store.list()).some(record => record.status === 'failed')).toBe(false);
  });
  it('does not claim a volatile save when IndexedDB fails', async () => {
    db.transaction.mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(createLoanOfflineQueueStore().add(input('lost'))).rejects.toThrow('quota');
    expect(records.size).toBe(0);
  });
});
