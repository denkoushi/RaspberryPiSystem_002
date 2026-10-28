import { isAxiosError } from 'axios';

import { registerOrderPlacement } from '../../../../api/client';
import { MOBILE_REQUEST_TIMEOUT_MS, mobileRequest } from '../../connectivity';
import { canSyncNow } from '../../sync/networkGate';
import { requestSync } from '../../sync/syncScheduler';

import { haizenOfflineQueueStore } from './haizenOfflineQueueStore';

import type { HaizenOfflineQueueStore, HaizenQueueRecord } from './haizenOfflineQueueStore';

type SendResult = { status: 'sent'; response: Awaited<ReturnType<typeof registerOrderPlacement>> }
  | { status: 'pending' | 'needs_check' };

const runners = new WeakMap<HaizenOfflineQueueStore, ReturnType<typeof createRunner>>();
export function haizenOutboxRunner(store: HaizenOfflineQueueStore = haizenOfflineQueueStore) {
  let runner = runners.get(store);
  if (!runner) { runner = createRunner(store); runners.set(store, runner); }
  return runner;
}

function createRunner(store: HaizenOfflineQueueStore) {
  let serial = Promise.resolve();
  const claimed = new Set<string>();
  const listeners = new Set<(records: HaizenQueueRecord[]) => void>();
  const sentListeners = new Set<() => void>();
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = serial.then(operation);
    serial = result.then(() => undefined, () => undefined);
    return result;
  };
  const refresh = (async () => {
    const next = await store.list();
    listeners.forEach((listener) => listener(next));
    return next;
  });

  const send = (async (record: HaizenQueueRecord): Promise<SendResult> => {
    if (!canSyncNow()) return { status: 'pending' };
    let response: Awaited<ReturnType<typeof registerOrderPlacement>>;
    try {
      response = await mobileRequest(() => registerOrderPlacement({
        shelfCodeRaw: record.shelfCode, manufacturingOrderBarcodeRaw: record.number,
        clientRecordId: record.clientRecordId, slipKind: record.slipKind, placedAt: record.scannedAt, branchNo: record.branchNo
      }, MOBILE_REQUEST_TIMEOUT_MS));
    } catch (error) {
      const httpResponse = isAxiosError(error) ? error.response : undefined;
      if (httpResponse && httpResponse.status >= 400 && httpResponse.status < 500 && httpResponse.status !== 408 && httpResponse.status !== 429) {
        await store.put({ ...record, status: 'needs_check', message: typeof httpResponse.data?.message === 'string'
          ? httpResponse.data.message : '登録内容を確認してください' });
        return { status: 'needs_check' };
      }
      return { status: 'pending' };
    }
    await store.remove(record.clientRecordId);
    sentListeners.forEach((listener) => listener());
    return { status: 'sent', response };
  });

  const drain = (async () => {
    const queued = await refresh();
    for (const record of queued) {
      if (record.status !== 'pending' || claimed.has(record.clientRecordId)) continue;
      const result = await send(record);
      await refresh();
      if (result.status === 'pending') break;
    }
  });
  const flush = (() => enqueue(drain));

  const sendSubmitted = (async (record: HaizenQueueRecord) => {
    // A later move of the same stamp must not overtake a saved placement; still-claimed records were submitted later.
    const waitingForEarlier = record.branchNo !== undefined && (await store.list()).some((item) =>
      item.clientRecordId !== record.clientRecordId && item.status === 'pending' && !claimed.has(item.clientRecordId) &&
      item.number.trim() === record.number.trim() && item.branchNo === record.branchNo);
    const result = waitingForEarlier ? { status: 'pending' as const } : await send(record);
    const next = await refresh();

    return { ...result, pendingCount: next.filter((item) => item.status === 'pending').length };
  });
  const submit = (async (record: Omit<HaizenQueueRecord, 'status' | 'message'>) => {
    const pendingRecord: HaizenQueueRecord = { ...record, status: 'pending' };
    // Persist before waiting for earlier sends so closing the page still leaves a replayable record.
    claimed.add(record.clientRecordId);
    try { await store.put(pendingRecord); } catch (error) { claimed.delete(record.clientRecordId); throw error; }
    if (!canSyncNow()) {
      claimed.delete(record.clientRecordId);
      const next = await refresh();
      requestSync('submit');
      return { status: 'pending' as const, pendingCount: next.filter((item) => item.status === 'pending').length };
    }
    // Only this outbox's own lane: a long local-data download must not delay the placement send.
    return enqueue(async () => {
      try { return await sendSubmitted(pendingRecord); } finally {
        claimed.delete(record.clientRecordId);
        requestSync('submit');
      }
    });
  });

  const remove = ((id: string) => enqueue(async () => {
    await store.remove(id);
    await refresh();
  }));
  const retake = ((id: string) => enqueue(async () => {
    const record = (await store.list()).find((item) => item.clientRecordId === id);
    if (record) await store.remove(id);
    await refresh();
    return record;
  }));

  return {
    submit, remove, retake, flush, refresh,
    hasPendingWork: async () => (await store.list()).some((record) => record.status === 'pending'),
    subscribe(listener: (records: HaizenQueueRecord[]) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onSent(listener: () => void) {
      sentListeners.add(listener);
      return () => { sentListeners.delete(listener); };
    }
  };
}
