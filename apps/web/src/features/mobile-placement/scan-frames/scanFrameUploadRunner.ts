import { isAxiosError } from 'axios';

import { api, getResolvedClientKey } from '../../../api/client';
import { haizenOfflineQueueStore, type HaizenOfflineQueueStore } from '../haizen/offline/haizenOfflineQueueStore';
import { canSyncNow } from '../sync/networkGate';

import { SCAN_FRAME_POLICY, scanFrameStore, type ScanFrameStore, type ScanFrameRecord } from './scanFrameStore';

const base64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});
async function payload(record: ScanFrameRecord) {
  return { ...record.meta, clientFrameId: record.id, kind: record.kind.replace('-', '_'),
    clientRecordId: record.clientRecordId, shelfCodeRaw: record.shelfCodeRaw, slipKind: record.slipKind,
    manualValue: record.manualValue, fullJpeg: await base64(record.fullJpeg), cropJpeg: record.cropJpeg ? await base64(record.cropJpeg) : undefined };
}
export function createScanFrameUploadRunner(store: ScanFrameStore = scanFrameStore, haizen: Pick<HaizenOfflineQueueStore, 'list'> = haizenOfflineQueueStore) {
  let running: Promise<void> | undefined;
  const isEligible = async (record: ScanFrameRecord) => {
    if (record.meta.outcome === 'timeout' && Date.now() - Date.parse(record.createdAt) < SCAN_FRAME_POLICY.manualInputGraceMs) return false;
    return record.kind !== 'placement-photo' || !(await haizen.list()).some((item) => item.clientRecordId === record.clientRecordId);
  };
  const run = async () => {
    let count = 0;
    let bytes = 0;
    for (const record of await store.list()) {
      if (!canSyncNow() || count >= 20) break;
      if (!await isEligible(record)) continue;
      let body: Awaited<ReturnType<typeof payload>>;
      let size: number;
      try {
        body = await payload(record);
        size = new TextEncoder().encode(JSON.stringify(body)).byteLength;
      } catch {
        console.warn('Scan frame payload could not be created', record.id);
        await store.remove(record.id);
        continue;
      }
      if (count > 0 && bytes + size > 2 * 1024 * 1024) break;
      if (!canSyncNow()) break;
      count += 1;
      bytes += size;
      try {
        await api.post('/mobile-placement/scan-frames', body, {
          headers: { 'x-client-key': getResolvedClientKey() }, timeout: SCAN_FRAME_POLICY.requestTimeoutMs
        });
      } catch (error) {
        const status = isAxiosError(error) ? error.response?.status : undefined;
        if (status !== 409 && status !== 400 && status !== 413 && status !== 422) break;
        if (status !== 409) console.warn('Scan frame rejected', record.id, status);
      }
      await store.remove(record.id);
    }
  };
  return {
    run: () => running ??= run().finally(() => { running = undefined; }),
    hasPendingWork: async () => {
      for (const record of await store.list()) if (await isEligible(record)) return true;
      return false;
    }
  };
}
export const scanFrameUploadRunner = createScanFrameUploadRunner();
