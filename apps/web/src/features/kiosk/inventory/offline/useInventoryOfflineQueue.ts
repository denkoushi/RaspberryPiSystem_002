import { useEffect } from 'react';

import { messageFromError } from '../inventoryPageModel';

import { inventoryOutboxRunner } from './inventoryOutboxRunner';

import type { Dispatch, SetStateAction } from 'react';

export function useInventoryOfflineQueue(
  setMessage: Dispatch<SetStateAction<string>>,
  setMessageKind: Dispatch<SetStateAction<'info' | 'success' | 'error'>>,
) {
  const runner = inventoryOutboxRunner();
  useEffect(() => {
    let active = true;
    let previousCounts = '';
    let previousFailures = new Set<string>();
    let lastFailureKey = '';
    const unsubscribe = runner.subscribe(records => {
      if (!active) return;
      const pending = records.filter(record => record.status === 'pending').length;
      const failed = records.length - pending;
      const counts = `${pending}:${failed}`;
      const failures = records.filter(record => record.status === 'failed');
      const failure = failures.find(record => !previousFailures.has(record.idempotencyKey))
        ?? failures.find(record => record.idempotencyKey === lastFailureKey);
      previousFailures = new Set(failures.map(record => record.idempotencyKey));
      const changedFailure = Boolean(failure && failure.idempotencyKey !== lastFailureKey);
      lastFailureKey = failure?.idempotencyKey ?? '';
      if (counts === previousCounts && !changedFailure) return;
      previousCounts = counts;
      if (!pending && !failed) return;
      if (failure?.message) {
        const display = failure.display;
        const quantity = display?.quantity ?? (failure.route === 'touchTransaction' ? failure.body.quantity : undefined);
        const movement = (display?.restock ?? failure.body.restock) ? '補充' : '払出';
        setMessage(`${display?.itemName ?? '品目不明'} ${quantity ?? '数量不明'} ${movement}失敗: ${failure.message}`);
        setMessageKind('error');
        return;
      }
      setMessage(`未送信 ${pending} 件${failed ? `・失敗 ${failed} 件` : ''}`);
      setMessageKind(failed ? 'error' : 'success');
    });
    void runner.refresh().catch(error => {
      if (!active) return;
      setMessage(messageFromError(error));
      setMessageKind('error');
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [runner, setMessage, setMessageKind]);
  return runner;
}
