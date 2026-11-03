import { isAxiosError } from 'axios';

import { loanOfflineQueueStore } from './loanOfflineQueueStore';
import { sendLoanRequest } from './loanQueueRequest';

import type { LoanOfflineQueueStore, LoanQueueRecord } from './loanOfflineQueueStore';
import type { LoanQueueRequest, LoanRequest } from './loanQueueRequest';

export function isRetryableLoanError(error: unknown): boolean {
  if (!isAxiosError(error) || error.code === 'ERR_CANCELED') return false;
  const status = error.response?.status;
  return status === undefined || (status >= 500 && status < 600);
}

function isDuplicateReturn(record: LoanQueueRequest, error: unknown): boolean {
  if (!record.route.endsWith('Return') || !isAxiosError(error)) return false;
  const response = error.response;
  return response?.status === 404 || (response?.status === 409 && (
    response.data?.code === 'LOAN_ALREADY_RETURNED' || response.data?.code === 'LOAN_ALREADY_CANCELLED' || response.data?.message === 'すでに返却済みです'
  ));
}

export function createLoanOutboxRunner(store: LoanOfflineQueueStore, send = sendLoanRequest) {
  let flushing: Promise<void> | undefined;
  const listeners = new Set<(records: LoanQueueRecord[], failure?: string) => void>();
  const sentListeners = new Set<() => void>();
  const refresh = async (failure?: string) => {
    const records = await store.list();
    listeners.forEach(listener => listener(records, failure));
    return records;
  };
  const drain = async () => {
    await store.prune();
    while (navigator.onLine) {
      const record = (await store.list())[0];
      if (!record) break;
      if (record.status === 'failed') {
        await store.remove(record.eventKey);
        await refresh(record.message);
        continue;
      }
      try {
        await send(record);
      } catch (error) {
        if (isRetryableLoanError(error)) break;
        if (!isDuplicateReturn(record, error)) {
          const message = isAxiosError(error) ? error.response?.data?.message ?? error.message : String(error);
          await store.remove(record.eventKey);
          await refresh(message);
          continue;
        }
      }
      await store.remove(record.eventKey);
      sentListeners.forEach(listener => listener());
      await refresh();
    }
    await refresh();
  };
  return {
    refresh,
    async submit(input: LoanRequest, readAt = new Date().toISOString()) {
      // Build once before the first attempt: even a lost response must replay the same eventKey.
      const request = { ...input, body: { ...input.body, eventKey: crypto.randomUUID(), readAt: new Date(readAt).toISOString() } } as LoanQueueRequest;
      try {
        const loan = await send(request);
        sentListeners.forEach(listener => listener());
        return loan;
      } catch (error) {
        if (!isRetryableLoanError(error)) throw error;
        await store.add(request); // Do not report success until IndexedDB confirms durability.
        await refresh();
        return undefined;
      }
    },
    flush() {
      flushing ??= drain().finally(() => { flushing = undefined; });
      return flushing;
    },
    subscribe(listener: (records: LoanQueueRecord[], failure?: string) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onSent(listener: () => void) {
      sentListeners.add(listener);
      return () => { sentListeners.delete(listener); };
    },
  };
}
export const loanOutboxRunner = createLoanOutboxRunner(loanOfflineQueueStore);
