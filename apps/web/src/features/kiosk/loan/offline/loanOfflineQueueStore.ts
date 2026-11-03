import { openDB } from 'idb';

import type { LoanQueueRequest } from './loanQueueRequest';
import type { DBSchema, IDBPObjectStore } from 'idb';

export type LoanQueueRecord = LoanQueueRequest & {
  eventKey: string;
  readAt: string;
  status: 'pending' | 'failed';
  message?: string;
};
export type LoanQueueInput = LoanQueueRequest;
interface QueueDb extends DBSchema {
  requests: { key: string; value: LoanQueueRecord };
}
export const LOAN_QUEUE_LIMIT = 500;
export const LOAN_QUEUE_FULL_MESSAGE = '送信待ちが上限です';
const FAILED_LIMIT = 50;
const FAILED_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function createLoanOfflineQueueStore() {
  let dbPromise: ReturnType<typeof openDB<QueueDb>> | undefined;
  const getDb = () => dbPromise ??= openDB<QueueDb>('kiosk-loan-offline-queue', 1, {
    upgrade(db) { db.createObjectStore('requests', { keyPath: 'eventKey' }); },
  }).catch(error => {
    dbPromise = undefined;
    throw error;
  });
  const pruneFailed = async (store: IDBPObjectStore<QueueDb, ['requests'], 'requests', 'readwrite'>) => {
    const records = await store.getAll();
    const failed = records.filter(record => record.status === 'failed')
      .sort((a, b) => b.readAt.localeCompare(a.readAt));
    const cutoff = Date.now() - FAILED_MAX_AGE;
    for (const [index, record] of failed.entries()) {
      if (index >= FAILED_LIMIT || Date.parse(record.readAt) < cutoff) await store.delete(record.eventKey);
    }
    return records.filter(record => record.status === 'pending').length;
  };
  return {
    async prune() {
      const tx = (await getDb()).transaction('requests', 'readwrite');
      await pruneFailed(tx.store);
      await tx.done;
    },
    async list(): Promise<LoanQueueRecord[]> {
      return (await (await getDb()).getAll('requests')).sort((a, b) => Date.parse(a.readAt) - Date.parse(b.readAt));
    },
    async add(input: LoanQueueInput) {
      const db = await getDb();
      // One readwrite transaction makes deduplication and the cap atomic across tabs/store instances.
      const tx = db.transaction('requests', 'readwrite');
      const eventKey = input.body.eventKey;
      const pending = await pruneFailed(tx.store);
      const existing = await tx.store.get(eventKey);
      if (existing) { await tx.done; return; }
      if (pending >= LOAN_QUEUE_LIMIT) {
        await tx.done;
        throw new Error(LOAN_QUEUE_FULL_MESSAGE);
      }
      await tx.store.add({ ...input, eventKey, readAt: input.body.readAt, status: 'pending' });
      await tx.done;
    },
    async fail(record: LoanQueueRecord, message: string) {
      await (await getDb()).put('requests', { ...record, status: 'failed', message });
    },
    async remove(eventKey: string) { await (await getDb()).delete('requests', eventKey); },
  };
}
export type LoanOfflineQueueStore = ReturnType<typeof createLoanOfflineQueueStore>;
export const loanOfflineQueueStore = createLoanOfflineQueueStore();
