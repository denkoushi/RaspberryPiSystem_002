import { useEffect, useState } from 'react';

import { shelfOfflineQueueStore } from './shelfOfflineQueueStore';
import { shelfOutboxRunner } from './shelfOutboxRunner';

import type { ShelfOfflineQueueStore, ShelfQueueRecord } from './shelfOfflineQueueStore';

export function useShelfOfflineQueue(store: ShelfOfflineQueueStore = shelfOfflineQueueStore) {
  const [records, setRecords] = useState<ShelfQueueRecord[]>([]);
  const runner = shelfOutboxRunner(store);
  useEffect(() => {
    const unsubscribe = runner.subscribe(setRecords);
    void runner.refresh();
    return unsubscribe;
  }, [runner]);
  return { records, submit: runner.submit, remove: runner.remove };
}
