import { isAxiosError } from 'axios';

import { api } from '../../../../api/http';
import { mobileRequest } from '../../connectivity';
import { canSyncNow } from '../../sync/networkGate';
import { requestSync } from '../../sync/syncScheduler';

import { createShelfClientRecordId, shelfOfflineQueueStore } from './shelfOfflineQueueStore';

import type { ShelfOfflineQueueStore, ShelfQueueRecord } from './shelfOfflineQueueStore';

const shelfRequestTimeoutMs = 60_000;
const runners = new WeakMap<ShelfOfflineQueueStore, ReturnType<typeof createRunner>>();
export function shelfOutboxRunner(store: ShelfOfflineQueueStore = shelfOfflineQueueStore) {
  let runner = runners.get(store);
  if (!runner) { runner = createRunner(store); runners.set(store, runner); }
  return runner;
}

function createRunner(store: ShelfOfflineQueueStore) {
  let serial = Promise.resolve();
  let saves = Promise.resolve();
  const listeners = new Set<(records: ShelfQueueRecord[]) => void>();
  const sentListeners = new Set<() => void>();
  const refresh = async () => {
    const next = await store.list();
    listeners.forEach((listener) => listener(next));
    return next;
  };
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = serial.then(async () => {
      try { return await operation(); } finally { await refresh(); }
    });
    serial = result.then(() => undefined, () => undefined);
    return result;
  };
  // Persistence must not queue behind a slow upload; serialize saves to deduplicate rapid taps.
  const save = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = saves.then(async () => {
      const value = await operation();
      await refresh();
      requestSync('submit');
      return value;
    });
    saves = result.then(() => undefined, () => undefined);
    return result;
  };

  const send = (async (record: ShelfQueueRecord): Promise<'sent' | 'pending' | 'needs_check'> => {
    if (!canSyncNow()) return 'pending';
    let current = record;
    try {
      try {
        await mobileRequest(() => api.post('/mobile-placement/shelves', {
          shelfCodeRaw: current.shelfCodeRaw, displayLabel: current.displayLabel
        }, { timeout: shelfRequestTimeoutMs }), { timeoutMs: shelfRequestTimeoutMs });
      } catch (error) {
        // Only a saved registration success permits treating a duplicate as our own shelf.
        if (!(current.stage === 'registered' && isAxiosError(error) && error.response?.status === 409)) throw error;
      }
      current = { ...current, stage: 'registered' };
      await store.put(current);
      if (!canSyncNow()) return 'pending';
      await mobileRequest(() => api.put(`/mobile-placement/shelves/${encodeURIComponent(current.shelfCodeRaw)}/photo`,
        current.photo, { timeout: shelfRequestTimeoutMs }), { timeoutMs: shelfRequestTimeoutMs });
    } catch (error) {
      const response = isAxiosError(error) ? error.response : undefined;
      if (response && response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) {
        await store.put({ ...current, status: 'needs_check', message: typeof response.data?.message === 'string'
          ? response.data.message : '登録内容を確認してください' });
        return 'needs_check';
      }
      return 'pending';
    }
    await store.remove(current.id);
    sentListeners.forEach((listener) => listener());
    return 'sent';
  });

  const flush = (() => enqueue(async () => {
    const saved = await store.list();
    listeners.forEach((listener) => listener(saved));
    for (const record of saved) {
      if (record.status === 'pending' && await send(record) === 'pending') break;
    }
  }));
  const submit = ((input: Pick<ShelfQueueRecord, 'shelfCodeRaw' | 'displayLabel' | 'photo'>) => save(async () => {
    // Also guard against a rapid second submit before the list has re-rendered.
    const existing = (await store.list()).find((record) => record.shelfCodeRaw === input.shelfCodeRaw);
    if (existing) return existing.status;
    const record: ShelfQueueRecord = { ...input, id: createShelfClientRecordId(), createdAt: new Date().toISOString(),
      stage: 'unregistered', status: 'pending' };
    await store.put(record);
    return 'pending' as const;
  }));
  const remove = ((id: string) => enqueue(() => store.remove(id)));

  return {
    submit, remove, flush, refresh,
    hasPendingWork: async () => (await store.list()).some((record) => record.status === 'pending'),
    subscribe(listener: (records: ShelfQueueRecord[]) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onSent(listener: () => void) {
      sentListeners.add(listener);
      return () => { sentListeners.delete(listener); };
    }
  };
}
