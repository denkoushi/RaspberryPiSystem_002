import { openDB, type IDBPDatabase } from 'idb';

import type { ScanFrameCapture } from '../../barcode-scan/scanFrameCapture';

export const SCAN_FRAME_POLICY = { maxRecords: 300, maxBytes: 60 * 1024 * 1024, slowMs: 1500, retries: 15, sampleRate: 0.1, manualInputGraceMs: 30_000, requestTimeoutMs: 30_000 };
export type ScanFrameRecord = {
  id: string;
  kind: 'scan-frame' | 'placement-photo';
  meta: Omit<ScanFrameCapture, 'fullCanvas'>;
  clientRecordId?: string;
  shelfCodeRaw?: string;
  slipKind?: 'manufacturing_order' | 'purchase_order';
  manualValue?: string;
  cropJpeg?: Blob;
  fullJpeg: Blob;
  createdAt: string;
};
export function shouldSampleFrame(meta: ScanFrameRecord['meta'], random = Math.random): boolean {
  return meta.outcome === 'timeout' || meta.decodeMs >= SCAN_FRAME_POLICY.slowMs || meta.retryCount >= SCAN_FRAME_POLICY.retries || random() < SCAN_FRAME_POLICY.sampleRate;
}
export function frameEvictions(records: ScanFrameRecord[], policy = SCAN_FRAME_POLICY): string[] {
  let bytes = records.reduce((sum, record) => sum + record.fullJpeg.size + (record.cropJpeg?.size ?? 0), 0);
  let count = records.length;
  const evictions: string[] = [];
  const ordered = [...records].sort((a, b) => Number(a.kind === 'placement-photo') - Number(b.kind === 'placement-photo') || a.createdAt.localeCompare(b.createdAt));
  for (const record of ordered) {
    if (count <= policy.maxRecords && bytes <= policy.maxBytes) break;
    evictions.push(record.id);
    count -= 1;
    bytes -= record.fullJpeg.size + (record.cropJpeg?.size ?? 0);
  }
  return evictions;
}
export interface ScanFrameStore {
  list(): Promise<ScanFrameRecord[]>;
  put(record: ScanFrameRecord): Promise<void>;
  remove(id: string): Promise<void>;
  updateManualValue(id: string, value: string): Promise<void>;
}
type FrameDb = IDBPDatabase<{ frames: { key: string; value: ScanFrameRecord } }>;
export function createScanFrameStore(): ScanFrameStore {
  let dbPromise: Promise<FrameDb> | undefined;
  const db = () => dbPromise ??= openDB('mobile-scan-frames-v1', 1, {
    upgrade(database) { database.createObjectStore('frames', { keyPath: 'id' }); }
  });
  return {
    async list() { return (await (await db()).getAll('frames')).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); },
    async put(record) {
      const tx = (await db()).transaction('frames', 'readwrite');
      await tx.store.put(record);
      const records = await tx.store.getAll();
      for (const id of frameEvictions(records)) await tx.store.delete(id);
      await tx.done;
    },
    async remove(id) { await (await db()).delete('frames', id); },
    async updateManualValue(id, value) {
      const tx = (await db()).transaction('frames', 'readwrite');
      const record = await tx.store.get(id);
      if (record) await tx.store.put({ ...record, manualValue: value });
      await tx.done;
    }
  };
}
export const scanFrameStore = createScanFrameStore();
