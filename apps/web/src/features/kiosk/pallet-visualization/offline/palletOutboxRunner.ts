import { isAxiosError } from 'axios';

import { palletOfflineQueueStore } from './palletOfflineQueueStore';
import { sendPalletRequest } from './palletQueueRequest';

import type { PalletOfflineQueueStore, PalletQueueRecord } from './palletOfflineQueueStore';
import type { PalletQueueRequest, PalletRequest } from './palletQueueRequest';

export function createPalletOutboxRunner(store: PalletOfflineQueueStore, send = sendPalletRequest) {
  let flushing: Promise<void> | undefined;
  const listeners = new Set<(records: PalletQueueRecord[], failure?: string) => void>();
  const sentListeners = new Set<() => void>();
  const refresh = async (failure?: string) => {
    const records = await store.list();
    listeners.forEach(listener => listener(records, failure));
    return records;
  };
  const drain = async () => {
    await store.prune();
    while (navigator.onLine) {
      const record = (await store.list()).find(item => item.status === 'pending');
      if (!record) break;
      try {
        await send(record);
      } catch (error) {
        if (!isAxiosError(error)) break;
        const status = error.response?.status;
        if (status === undefined || status < 400 || status >= 500) break;
        const message = error.response?.data?.message ?? error.message;
        await store.fail(record, message);
        await refresh(message);
        continue;
      }
      await store.remove(record.eventKey);
      sentListeners.forEach(listener => listener());
      await refresh();
    }
    await refresh();
  };
  const flush = (): Promise<void> => {
    flushing ??= (async () => {
      if (navigator.locks) await navigator.locks.request('kiosk-pallet-outbox', drain);
      else await drain();
    })().finally(() => { flushing = undefined; });
    return flushing;
  };
  return {
    refresh,
    async submit(input: PalletRequest, readAt = new Date().toISOString()) {
      const request = { ...input, body: { ...input.body, eventKey: crypto.randomUUID(), readAt: new Date(readAt).toISOString() } } as PalletQueueRequest;
      await store.add(request);
      await refresh();
      await flush();
    },
    flush,
    subscribe(listener: (records: PalletQueueRecord[], failure?: string) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onSent(listener: () => void) {
      sentListeners.add(listener);
      return () => { sentListeners.delete(listener); };
    },
  };
}
export const palletOutboxRunner = createPalletOutboxRunner(palletOfflineQueueStore);
