import { openDB, type IDBPDatabase } from 'idb';

import type { LocalPlacementRow } from '@raspi-system/slip-match-core';

export type PlacementDeleteRecord = {
  id: string;
  row: LocalPlacementRow;
  queuedAt: string;
  status: 'pending' | 'needs_check';
};

export interface PlacementDeleteQueueStore {
  subscribe(listener: () => void): () => void;
  list(): Promise<PlacementDeleteRecord[]>;
  put(record: PlacementDeleteRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

type QueueDb = IDBPDatabase<{ records: { key: string; value: PlacementDeleteRecord } }>;

export function createPlacementDeleteQueueStore(name = 'placement-delete-queue'): PlacementDeleteQueueStore {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  const memory = new Map<string, PlacementDeleteRecord>();
  let dbPromise: Promise<QueueDb> | null = null;
  let memoryOnly = false;
  // Writes not yet committed to IndexedDB; a list() that read before them must not drop them (null = removed).
  const writing = new Map<string, PlacementDeleteRecord | null>();
  async function write(id: string, record: PlacementDeleteRecord | null, commit: (db: QueueDb) => Promise<unknown>) {
    writing.set(id, record);
    try { await commit(await getDb()); } catch { memoryOnly = true; } finally {
      if (writing.get(id) === record) writing.delete(id);
    }
  }
  function getDb(): Promise<QueueDb> {
    if (memoryOnly || typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
    dbPromise ??= openDB(name, 1, {
      upgrade(db) { db.createObjectStore('records', { keyPath: 'id' }); }
    });
    return dbPromise;
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async list() {
      try {
        const db = await getDb();
        const records = await db.getAll('records');
        memory.clear();
        records.forEach((record) => memory.set(record.id, record));
        writing.forEach((record, id) => { if (record) memory.set(id, { ...record }); else memory.delete(id); });
      } catch { memoryOnly = true; }
      return [...memory.values()].map((record) => ({ ...record })).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
    },
    async put(record) {
      memory.set(record.id, { ...record });
      await write(record.id, record, (db) => db.put('records', record));
      notify();
    },
    async remove(id) {
      memory.delete(id);
      await write(id, null, (db) => db.delete('records', id));
      notify();
    }
  };
}

export const placementDeleteQueueStore = createPlacementDeleteQueueStore();
