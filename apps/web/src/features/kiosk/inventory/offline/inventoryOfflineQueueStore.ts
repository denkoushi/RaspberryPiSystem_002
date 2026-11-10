import { openDB } from 'idb';

import type { processInventoryTouchTransaction, processInventoryTransaction } from '../../../../api/client';
import type { DBSchema, IDBPObjectStore } from 'idb';

type Request = { route: 'transaction'; body: Parameters<typeof processInventoryTransaction>[0] }
  | { route: 'touchTransaction'; body: Omit<Parameters<typeof processInventoryTouchTransaction>[0], 'expectedBeforeQuantity'> & { idempotencyKey: string } };
export type InventoryQueueRecord = Request & {
  idempotencyKey: string;
  createdAt: string;
  status: 'pending' | 'failed';
  message?: string;
  attempts?: number;
  lastAttemptAt?: string;
  display?: { itemName?: string; quantity: number; restock: boolean };
};
export type InventoryQueueInput = Request & Pick<InventoryQueueRecord, 'createdAt' | 'display'>;
interface QueueDb extends DBSchema {
  requests: { key: string; value: InventoryQueueRecord };
}
export const INVENTORY_QUEUE_LIMIT = 500;
export const INVENTORY_QUEUE_FULL_MESSAGE = '送信待ちが上限です';
const FAILED_LIMIT = 50;
const FAILED_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export function createInventoryOfflineQueueStore() {
  let dbPromise: ReturnType<typeof openDB<QueueDb>> | undefined;
  const getDb = () => dbPromise ??= openDB<QueueDb>('kiosk-inventory-offline-queue', 1, {
    upgrade(db) { db.createObjectStore('requests', { keyPath: 'idempotencyKey' }); },
  }).catch(error => {
    dbPromise = undefined;
    throw error;
  });
  const pruneFailed = async (store: IDBPObjectStore<QueueDb, ['requests'], 'requests', 'readwrite'>) => {
    const records = await store.getAll();
    const failed = records.filter(record => record.status === 'failed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const cutoff = Date.now() - FAILED_MAX_AGE;
    for (const [index, record] of failed.entries()) {
      if (index >= FAILED_LIMIT || Date.parse(record.createdAt) < cutoff) await store.delete(record.idempotencyKey);
    }
    return records.filter(record => record.status === 'pending').length;
  };
  return {
    async prune() {
      const tx = (await getDb()).transaction('requests', 'readwrite');
      await pruneFailed(tx.store);
      await tx.done;
    },
    async list(): Promise<InventoryQueueRecord[]> {
      return (await (await getDb()).getAll('requests')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async add(input: InventoryQueueInput) {
      const db = await getDb();
      // One readwrite transaction makes deduplication and the cap atomic across tabs/store instances.
      const tx = db.transaction('requests', 'readwrite');
      const idempotencyKey = input.body.idempotencyKey;
      const pending = await pruneFailed(tx.store);
      const existing = await tx.store.get(idempotencyKey);
      if (existing) { await tx.done; return; }
      if (pending >= INVENTORY_QUEUE_LIMIT) {
        await tx.done;
        throw new Error(INVENTORY_QUEUE_FULL_MESSAGE);
      }
      await tx.store.add({ ...input, idempotencyKey, status: 'pending' });
      await tx.done;
    },
    async recordAttempt(record: InventoryQueueRecord) {
      const updated = { ...record, attempts: (record.attempts ?? 0) + 1, lastAttemptAt: new Date().toISOString() };
      await (await getDb()).put('requests', updated);
      return updated;
    },
    async fail(record: InventoryQueueRecord, message: string) {
      await (await getDb()).put('requests', { ...record, status: 'failed', message });
    },
    async remove(idempotencyKey: string) { await (await getDb()).delete('requests', idempotencyKey); },
  };
}
export type InventoryOfflineQueueStore = ReturnType<typeof createInventoryOfflineQueueStore>;
export const inventoryOfflineQueueStore = createInventoryOfflineQueueStore();
