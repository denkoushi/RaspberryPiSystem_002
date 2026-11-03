import { isAxiosError } from 'axios';

import { postClientLogs, processInventoryTouchTransaction, processInventoryTransaction } from '../../../../api/client';
import { messageFromError } from '../inventoryPageModel';

import { inventoryOfflineQueueStore } from './inventoryOfflineQueueStore';

import type { InventoryOfflineQueueStore, InventoryQueueInput, InventoryQueueRecord } from './inventoryOfflineQueueStore';

export function isRetryableInventoryError(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === undefined || status === 408 || status === 429 || (status >= 500 && status < 600);
}
const runners = new WeakMap<InventoryOfflineQueueStore, ReturnType<typeof createRunner>>();
export function inventoryOutboxRunner(store = inventoryOfflineQueueStore) {
  let runner = runners.get(store);
  if (!runner) { runner = createRunner(store); runners.set(store, runner); }
  return runner;
}
function createRunner(store: InventoryOfflineQueueStore) {
  let flushing: Promise<void> | undefined;
  const listeners = new Set<(records: InventoryQueueRecord[]) => void>();
  const sentListeners = new Set<() => void>();
  const refresh = async () => {
    const records = await store.list();
    listeners.forEach(listener => listener(records));
    return records;
  };
  const drain = async () => {
    await store.prune();
    while (navigator.onLine) {
      let record = (await store.list()).find(item => item.status === 'pending');
      if (!record) break;
      try {
        // Replay the business request as saved, without resolving/re-emitting NFC events.
        if (record.route === 'transaction') await processInventoryTransaction(record.body);
        else await processInventoryTouchTransaction(record.body);
      } catch (error) {
        let message = messageFromError(error);
        if (isRetryableInventoryError(error)) {
          // No response gives no evidence that the server can process the queue. Keep waiting.
          if (!isAxiosError(error) || !error.response) break;
          record = await store.recordAttempt(record);
          const exhausted = record.attempts! >= 20;
          const expired = Date.now() - Date.parse(record.createdAt) > 24 * 60 * 60 * 1000;
          if (!exhausted && !expired) break;
          message = `${exhausted ? '再送20回' : '作成から24時間超過'}: HTTP ${error.response.status} ${message}`;
        }
        await store.fail(record, message);
        const failed = { ...record, status: 'failed', message };
        console.warn('Inventory offline request failed', failed);
        // Only the pending -> failed transition reports; telemetry never blocks the queue.
        void postClientLogs({ clientId: 'kiosk-web', logs: [{
          level: 'ERROR', message: 'Inventory offline request failed',
          context: { ...failed, category: 'inventory_offline_failure' },
        }] }).catch(() => { /* Best effort, once per failed record. */ });
        await refresh();
        await store.prune();
        continue;
      }
      await store.remove(record.idempotencyKey);
      sentListeners.forEach(listener => listener());
      await refresh();
    }
    await refresh();
  };
  return {
    refresh,
    async hasPending() { return (await store.list()).some(record => record.status === 'pending'); },
    async save(input: InventoryQueueInput) { await store.add(input); return refresh(); },
    flush() {
      flushing ??= drain().finally(() => { flushing = undefined; });
      return flushing;
    },
    subscribe(listener: (records: InventoryQueueRecord[]) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onSent(listener: () => void) {
      sentListeners.add(listener);
      return () => { sentListeners.delete(listener); };
    },
  };
}
