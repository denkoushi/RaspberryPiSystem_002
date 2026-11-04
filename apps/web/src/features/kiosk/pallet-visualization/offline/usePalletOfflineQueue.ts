import { useEffect, useState } from 'react';

import { palletOutboxRunner } from './palletOutboxRunner';

import type { PalletQueueRecord } from './palletOfflineQueueStore';

export function usePalletOfflineQueue() {
  const [message, setMessage] = useState('');
  const [records, setRecords] = useState<PalletQueueRecord[]>([]);
  useEffect(() => {
    let active = true;
    let failureMessage: string | undefined;
    // A rejected request stays in the store as failed; its message is shown until the next request is accepted.
    const offSent = palletOutboxRunner.onSent(() => { failureMessage = undefined; });
    const off = palletOutboxRunner.subscribe((records, failure) => {
      setRecords(records);
      if (failure) failureMessage = failure;
      const pending = records.filter(record => record.status === 'pending').length;
      setMessage(failureMessage ? `未送信 ${pending} 件・${failureMessage}` : pending ? `未送信 ${pending} 件` : '');
    });
    void palletOutboxRunner.refresh().catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; off(); offSent(); };
  }, []);
  return { message, records, submit: palletOutboxRunner.submit };
}
