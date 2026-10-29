import { isAxiosError } from 'axios';

import { api, getResolvedClientKey } from '../../../api/client';
import { canSyncNow } from '../sync/networkGate';

import { verifyRecordStore, type VerifyRecordStore } from './verifyRecordStore';

export function createVerifyRecordUploadRunner(store: VerifyRecordStore = verifyRecordStore) {
  let running: Promise<void> | undefined;
  const run = async () => {
    for (const record of (await store.list()).slice(0, 20)) {
      if (!canSyncNow()) break;
      try {
        await api.post('/mobile-placement/verify-records', record, {
          headers: { 'x-client-key': getResolvedClientKey() }, timeout: 30_000
        });
      } catch (error) {
        const status = isAxiosError(error) ? error.response?.status : undefined;
        if (status !== 409 && status !== 400) break;
        if (status !== 409) console.warn('Verify record rejected', record.clientVerifyId, status);
      }
      await store.remove(record);
    }
  };
  return {
    run: () => running ??= run().finally(() => { running = undefined; }),
    hasPendingWork: async () => (await store.list()).length > 0
  };
}
export const verifyRecordUploadRunner = createVerifyRecordUploadRunner();
