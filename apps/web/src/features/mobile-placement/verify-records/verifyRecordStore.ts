import { openDB, type IDBPDatabase } from 'idb';

export type VerifyRecord = {
  clientVerifyId: string;
  verifiedAt: string;
  transferOrderBarcodeRaw: string;
  transferPartRaw?: string;
  actualOrderBarcodeRaw: string;
  actualFseibanRaw: string;
  actualPartRaw?: string;
  outcome: 'match' | 'mismatch' | 'not_found' | 'error';
  reason?: string;
  expectedFseiban?: string;
  expectedFhincd?: string;
  expectedPartName?: string;
  actualResolvedFseiban?: string;
  actualPartCode?: string;
  matchedBy?: 'part_name';
  clientRecordId?: string;
};
export interface VerifyRecordStore {
  list(): Promise<VerifyRecord[]>;
  put(record: VerifyRecord): Promise<void>;
  remove(record: VerifyRecord): Promise<void>;
}
type VerifyDb = IDBPDatabase<{ records: { key: string; value: VerifyRecord } }>;
export function createVerifyRecordStore(): VerifyRecordStore {
  const memory = new Map<string, VerifyRecord>();
  let dbPromise: Promise<VerifyDb> | undefined;
  let memoryOnly = false;
  let queue = Promise.resolve();
  const db = () => dbPromise ??= openDB('mobile-verify-records-v1', 1, {
    upgrade(database) { database.createObjectStore('records', { keyPath: 'clientVerifyId' }); }
  });
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const pending = queue.then(work);
    queue = pending.then(() => {}, () => {});
    return pending;
  };
  const persist = async (work: (database: VerifyDb) => Promise<unknown>) => {
    if (memoryOnly) return;
    try { await work(await db()); } catch { memoryOnly = true; }
  };
  return {
    list: () => serial(async () => {
      await persist(async (database) => {
        const records = await database.getAll('records');
        memory.clear();
        records.forEach(record => memory.set(record.clientVerifyId, record));
      });
      return [...memory.values()].map(record => ({ ...record })).sort((a, b) => a.verifiedAt.localeCompare(b.verifiedAt));
    }),
    put: (record) => serial(async () => {
      memory.set(record.clientVerifyId, { ...record });
      await persist(database => database.put('records', record));
    }),
    remove: (record) => serial(async () => {
      // A link added during the upload needs a second POST, even if the first succeeded.
      if (memory.get(record.clientVerifyId)?.clientRecordId !== record.clientRecordId) return;
      memory.delete(record.clientVerifyId);
      await persist(async (database) => {
        const tx = database.transaction('records', 'readwrite');
        const current = await tx.store.get(record.clientVerifyId);
        if (current?.clientRecordId === record.clientRecordId) await tx.store.delete(record.clientVerifyId);
        await tx.done;
      });
    })
  };
}
export const verifyRecordStore = createVerifyRecordStore();
