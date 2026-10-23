import { openDB, type IDBPDatabase } from 'idb';

export type HaizenQueueRecord = {
  clientRecordId: string;
  slipKind: 'manufacturing_order' | 'purchase_order';
  number: string;
  shelfCode: string;
  scannedAt: string;
  status: 'pending' | 'needs_check';
  message?: string;
};

export interface HaizenOfflineQueueStore {
  list(): Promise<HaizenQueueRecord[]>;
  put(record: HaizenQueueRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

type QueueDb = IDBPDatabase<{ records: { key: string; value: HaizenQueueRecord } }>;

export function createHaizenOfflineQueueStore(): HaizenOfflineQueueStore {
  const memory = new Map<string, HaizenQueueRecord>();
  let dbPromise: Promise<QueueDb> | null = null;
  let memoryOnly = false;
  function getDb(): Promise<QueueDb> {
    if (memoryOnly || typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
    dbPromise ??= openDB('haizen-offline-queue', 1, {
      upgrade(db) { db.createObjectStore('records', { keyPath: 'clientRecordId' }); }
    });
    return dbPromise;
  }
  return {
    async list() {
      try {
        const db = await getDb();
        const records = await db.getAll('records');
        memory.clear();
        records.forEach((record) => memory.set(record.clientRecordId, record));
      } catch { memoryOnly = true; }
      return [...memory.values()].map((record) => ({ ...record })).sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
    },
    async put(record) {
      memory.set(record.clientRecordId, { ...record });
      try { const db = await getDb(); await db.put('records', record); } catch { memoryOnly = true; }
    },
    async remove(id) {
      memory.delete(id);
      try { const db = await getDb(); await db.delete('records', id); } catch { memoryOnly = true; }
    }
  };
}

export function createHaizenClientRecordId(): string {
  try { return crypto.randomUUID(); } catch {
    // UUID v4 shape for browsers without randomUUID (including non-secure contexts).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const value = Math.floor(Math.random() * 16);
      return (character === 'x' ? value : (value & 3) | 8).toString(16);
    });
  }
}

export const haizenOfflineQueueStore = createHaizenOfflineQueueStore();
