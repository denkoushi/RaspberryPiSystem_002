import { useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useCallback, useEffect, useRef, useState } from 'react';

import { registerOrderPlacement } from '../../../../api/client';
import { canUseMobileNetwork, MOBILE_REQUEST_TIMEOUT_MS, mobileRequest, useMobileConnectivity } from '../../connectivity';
import { mobilePlacementQueryKeys } from '../../mobilePlacementQueryKeys';

import { haizenOfflineQueueStore } from './haizenOfflineQueueStore';

import type { HaizenOfflineQueueStore, HaizenQueueRecord } from './haizenOfflineQueueStore';

type SendResult = { status: 'sent'; response: Awaited<ReturnType<typeof registerOrderPlacement>> }
  | { status: 'pending' | 'needs_check' };

export function useHaizenOfflineQueue(store: HaizenOfflineQueueStore = haizenOfflineQueueStore) {
  const queryClient = useQueryClient();
  const [records, setRecords] = useState<HaizenQueueRecord[]>([]);
  const online = useMobileConnectivity();
  const serial = useRef(Promise.resolve());
  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = serial.current.then(operation);
    serial.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);
  const refresh = useCallback(async () => {
    const next = await store.list();
    setRecords(next);
    return next;
  }, [store]);

  const send = useCallback(async (record: HaizenQueueRecord): Promise<SendResult> => {
    if (!canUseMobileNetwork()) return { status: 'pending' };
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
    void queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.registeredShelves });
    void queryClient.invalidateQueries({ queryKey: mobilePlacementQueryKeys.orderPlacementBranchesAll });
    return { status: 'sent', response };
  }, [queryClient, store]);

  const drain = useCallback(async () => {
    const queued = await refresh();
    for (const record of queued) {
      if (record.status !== 'pending') continue;
      const result = await send(record);
      await refresh();
      if (result.status === 'pending') break;
    }
  }, [refresh, send]);
  const flush = useCallback(() => enqueue(drain), [drain, enqueue]);

  const submit = useCallback((record: Omit<HaizenQueueRecord, 'status' | 'message'>) => enqueue(async () => {
    const pendingRecord: HaizenQueueRecord = { ...record, status: 'pending' };
    // Persist before sending so closing the page during a request still leaves a replayable record.
    await store.put(pendingRecord);
    // A later move of the same stamp must not overtake a saved placement.
    const waitingForEarlier = record.branchNo !== undefined && (await store.list()).some((item) =>
      item.clientRecordId !== record.clientRecordId && item.status === 'pending' &&
      item.number.trim() === record.number.trim() && item.branchNo === record.branchNo);
    const result = waitingForEarlier ? { status: 'pending' as const } : await send(pendingRecord);
    const next = await refresh();
    if (result.status === 'sent' || waitingForEarlier) void flush();
    return { ...result, pendingCount: next.filter((item) => item.status === 'pending').length };
  }), [enqueue, flush, refresh, send, store]);

  const remove = useCallback((id: string) => enqueue(async () => {
    await store.remove(id);
    await refresh();
  }), [enqueue, refresh, store]);
  const retake = useCallback((id: string) => enqueue(async () => {
    const record = (await store.list()).find((item) => item.clientRecordId === id);
    if (record) await store.remove(id);
    await refresh();
    return record;
  }), [enqueue, refresh, store]);

  const pending = records.filter((record) => record.status === 'pending');
  const needsCheck = records.filter((record) => record.status === 'needs_check');
  useEffect(() => {
    void flush();
    const onOnline = () => { void flush(); };
    window.addEventListener('online', onOnline);
    return () => { window.removeEventListener('online', onOnline); };
  }, [flush, online]);
  useEffect(() => {
    if (!pending.length) return;
    const timer = window.setInterval(() => { void flush(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [flush, pending.length]);

  return { pending, needsCheck, offline: !online, submit, remove, retake };
}
