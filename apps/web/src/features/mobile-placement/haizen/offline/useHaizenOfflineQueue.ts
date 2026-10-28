import { useEffect, useState } from 'react';

import { useCanSync } from '../../sync/networkGate';

import { haizenOfflineQueueStore } from './haizenOfflineQueueStore';
import { haizenOutboxRunner } from './haizenOutboxRunner';

import type { HaizenOfflineQueueStore, HaizenQueueRecord } from './haizenOfflineQueueStore';

export function useHaizenOfflineQueue(store: HaizenOfflineQueueStore = haizenOfflineQueueStore) {
  const [records, setRecords] = useState<HaizenQueueRecord[]>([]);
  const online = useCanSync();
  const runner = haizenOutboxRunner(store);
  useEffect(() => {
    const unsubscribe = runner.subscribe(setRecords);
    void runner.refresh();
    return unsubscribe;
  }, [runner]);
  return {
    pending: records.filter((record) => record.status === 'pending'),
    needsCheck: records.filter((record) => record.status === 'needs_check'),
    offline: !online, submit: runner.submit, remove: runner.remove, retake: runner.retake
  };
}
