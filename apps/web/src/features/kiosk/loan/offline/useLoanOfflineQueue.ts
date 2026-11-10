import { useEffect, useState } from 'react';

import { loanOutboxRunner } from './loanOutboxRunner';

export function useLoanOfflineQueue() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    let failureMessage: string | undefined;
    const off = loanOutboxRunner.subscribe((records, failure) => {
      if (failure) failureMessage = failure;
      const pending = records.filter(record => record.status === 'pending').length;
      setMessage(failureMessage ? `未送信 ${pending} 件・${failureMessage}` : pending ? `未送信 ${pending} 件` : '');
    });
    void loanOutboxRunner.refresh().catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; off(); };
  }, []);
  return { message, submit: loanOutboxRunner.submit };
}
