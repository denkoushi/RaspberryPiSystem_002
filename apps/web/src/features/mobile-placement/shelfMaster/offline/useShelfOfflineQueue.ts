import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useState } from 'react';

import { postMobilePlacementShelfRegister, putMobilePlacementShelfPhoto } from '../../../../api/client';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';

import { createShelfClientRecordId, shelfOfflineQueueStore } from './shelfOfflineQueueStore';

import type { ShelfOfflineQueueStore, ShelfQueueRecord } from './shelfOfflineQueueStore';

const connected = () => typeof navigator === 'undefined' || navigator.onLine !== false;
// Share serialization across the master and hub, including requests surviving a screen change.
const queues = new WeakMap<ShelfOfflineQueueStore, {
  serial: Promise<void>;
  listeners: Set<(records: ShelfQueueRecord[]) => void>;
}>();
function queueFor(store: ShelfOfflineQueueStore) {
  let queue = queues.get(store);
  if (!queue) {
    queue = { serial: Promise.resolve(), listeners: new Set() };
    queues.set(store, queue);
  }
  return queue;
}

export function useShelfOfflineQueue(store: ShelfOfflineQueueStore = shelfOfflineQueueStore) {
  const client = useQueryClient();
  const [records, setRecords] = useState<ShelfQueueRecord[]>([]);
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const queue = queueFor(store);
    const result = queue.serial.then(async () => {
      try { return await operation(); } finally {
        const next = await store.list();
        queue.listeners.forEach((listener) => listener(next));
      }
    });
    queue.serial = result.then(() => undefined, () => undefined);
    return result;
  }, [store]);

  const send = useCallback(async (record: ShelfQueueRecord): Promise<'sent' | 'pending' | 'needs_check'> => {
    if (!connected()) return 'pending';
    let current = record;
    try {
      try {
        await postMobilePlacementShelfRegister({ shelfCodeRaw: current.shelfCodeRaw, displayLabel: current.displayLabel });
      } catch (error) {
        // Only a saved registration success permits treating a duplicate as our own shelf.
        if (!(current.stage === 'registered' && isAxiosError(error) && error.response?.status === 409)) throw error;
      }
      current = { ...current, stage: 'registered' };
      await store.put(current);
      await putMobilePlacementShelfPhoto(current.shelfCodeRaw, current.photo);
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
    void client.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
    return 'sent';
  }, [client, store]);

  const flush = useCallback(() => enqueue(async () => {
    const saved = await store.list();
    queueFor(store).listeners.forEach((listener) => listener(saved));
    for (const record of saved) {
      if (record.status === 'pending' && await send(record) === 'pending') break;
    }
  }), [enqueue, send, store]);
  const submit = useCallback((input: Pick<ShelfQueueRecord, 'shelfCodeRaw' | 'displayLabel' | 'photo'>) => enqueue(async () => {
    // Also guard against a rapid second submit before the list has re-rendered.
    const existing = (await store.list()).find((record) => record.shelfCodeRaw === input.shelfCodeRaw);
    if (existing) return existing.status;
    const record: ShelfQueueRecord = { ...input, id: createShelfClientRecordId(), createdAt: new Date().toISOString(),
      stage: 'unregistered', status: 'pending' };
    await store.put(record);
    return send(record);
  }), [enqueue, send, store]);
  const remove = useCallback((id: string) => enqueue(() => store.remove(id)), [enqueue, store]);

  useEffect(() => {
    const listeners = queueFor(store).listeners;
    listeners.add(setRecords);
    void flush();
    const onOnline = () => { void flush(); };
    window.addEventListener('online', onOnline);
    return () => { listeners.delete(setRecords); window.removeEventListener('online', onOnline); };
  }, [flush, store]);
  useEffect(() => {
    if (!records.some((record) => record.status === 'pending')) return;
    const timer = window.setInterval(() => { void flush(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [flush, records]);

  return { records, submit, remove };
}
