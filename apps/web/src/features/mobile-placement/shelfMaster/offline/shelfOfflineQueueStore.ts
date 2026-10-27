import { openDB, type IDBPDatabase } from 'idb';

export type ShelfQueueRecord = {
  id: string;
  shelfCodeRaw: string;
  displayLabel: string | null;
  photo: { contentType: 'image/jpeg'; dataBase64: string };
  createdAt: string;
  stage: 'unregistered' | 'registered';
  status: 'pending' | 'needs_check';
  message?: string;
};

export interface ShelfOfflineQueueStore {
  list(): Promise<ShelfQueueRecord[]>;
  put(record: ShelfQueueRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

type QueueDb = IDBPDatabase<{ records: { key: string; value: ShelfQueueRecord } }>;

export function createShelfOfflineQueueStore(): ShelfOfflineQueueStore {
  const memory = new Map<string, ShelfQueueRecord>();
  let dbPromise: Promise<QueueDb> | null = null;
  let memoryOnly = false;
  function getDb(): Promise<QueueDb> {
    if (memoryOnly || typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
    dbPromise ??= openDB('shelf-offline-queue', 1, {
      upgrade(db) { db.createObjectStore('records', { keyPath: 'id' }); }
    });
    return dbPromise;
  }
  return {
    async list() {
      try {
        const db = await getDb();
        const records = await db.getAll('records');
        memory.clear();
        records.forEach((record) => memory.set(record.id, record));
      } catch { memoryOnly = true; }
      return [...memory.values()].map((record) => ({ ...record })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },
    async put(record) {
      memory.set(record.id, { ...record });
      try { const db = await getDb(); await db.put('records', record); } catch { memoryOnly = true; }
    },
    async remove(id) {
      memory.delete(id);
      try { const db = await getDb(); await db.delete('records', id); } catch { memoryOnly = true; }
    }
  };
}

export function createShelfClientRecordId(): string {
  try { return crypto.randomUUID(); } catch {
    // UUID v4 shape for browsers without randomUUID (including non-secure contexts).
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
      const value = Math.floor(Math.random() * 16);
      return (character === 'x' ? value : (value & 3) | 8).toString(16);
    });
  }
}

export const shelfOfflineQueueStore = createShelfOfflineQueueStore();
