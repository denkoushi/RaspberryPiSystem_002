import { openDB } from 'idb';

import type { PalletQueueRequest } from './palletQueueRequest';
import type { DBSchema, IDBPObjectStore } from 'idb';

export type PalletQueueRecord = PalletQueueRequest & {
  eventKey: string;
  readAt: string;
  sequence: number;
  status: 'pending' | 'failed';
  message?: string;
};
export type PalletQueueInput = PalletQueueRequest;
interface QueueDb extends DBSchema {
  requests: { key: string; value: PalletQueueRecord };
}
export const PALLET_QUEUE_LIMIT = 500;
export const PALLET_QUEUE_FULL_MESSAGE = '送信待ちが上限です';
const FAILED_LIMIT = 50;
const FAILED_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function createPalletOfflineQueueStore() {
  let dbPromise: ReturnType<typeof openDB<QueueDb>> | undefined;
  const getDb = () => dbPromise ??= openDB<QueueDb>('kiosk-pallet-offline-queue', 1, {
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
    async list(): Promise<PalletQueueRecord[]> {
      return (await (await getDb()).getAll('requests')).sort((a, b) => a.sequence - b.sequence);
    },
    async add(input: PalletQueueInput) {
      const db = await getDb();
      // One readwrite transaction makes deduplication and the cap atomic across tabs/store instances.
      const tx = db.transaction('requests', 'readwrite');
      const eventKey = input.body.eventKey;
      const pending = await pruneFailed(tx.store);
      const existing = await tx.store.get(eventKey);
      if (existing) { await tx.done; return; }
      if (pending >= PALLET_QUEUE_LIMIT) {
        await tx.done;
        throw new Error(PALLET_QUEUE_FULL_MESSAGE);
      }
      const sequence = Math.max(0, ...(await tx.store.getAll()).map(record => record.sequence)) + 1;
      await tx.store.add({ ...input, sequence, eventKey, readAt: input.body.readAt, status: 'pending' });
      await tx.done;
    },
    async fail(record: PalletQueueRecord, message: string) {
      await (await getDb()).put('requests', { ...record, status: 'failed', message });
    },
    async remove(eventKey: string) { await (await getDb()).delete('requests', eventKey); },
  };
}
export type PalletOfflineQueueStore = ReturnType<typeof createPalletOfflineQueueStore>;
export const palletOfflineQueueStore = createPalletOfflineQueueStore();
