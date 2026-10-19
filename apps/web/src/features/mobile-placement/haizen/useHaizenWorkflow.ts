import { useEffect, useRef, useState } from 'react';

import type { useMobilePlacementPageState } from '../useMobilePlacementPageState';

export type HaizenState = ReturnType<typeof useMobilePlacementPageState>;

/** Serialize automatic verification so an older response cannot overwrite the latest pair. */
export function useHaizenWorkflow(mp: HaizenState) {
  const { transferOrder, actualOrder, runSlipVerify, setOrderBarcode, scanField } = mp;
  const queue = useRef(Promise.resolve());
  const [verified, setVerified] = useState<typeof runSlipVerify | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { setOrderBarcode(transferOrder); }, [transferOrder, setOrderBarcode]);

  useEffect(() => {
    let current = true;
    setVerified(null);
    if (transferOrder.trim() && actualOrder.trim() && scanField === null) {
      queue.current = queue.current.then(async () => {
        if (!current) return;
        await runSlipVerify();
        if (current) setVerified(() => runSlipVerify);
      });
    }
    return () => { current = false; };
  }, [transferOrder, actualOrder, runSlipVerify, scanField]);

  const {
    registerMessage, setTransferOrder, setTransferPart, setActualOrder, setActualPart,
    setActualFseiban, selectShelf, resetSlipResult, resetActualSlipOcrFeedback,
    setOrderPlacementIntent, setSelectedBranchId
  } = mp;
  useEffect(() => {
    if (!registerMessage) return;
    setToast(registerMessage);
    setTransferOrder('');
    setTransferPart('');
    setActualOrder('');
    setActualPart('');
    setActualFseiban('');
    setOrderBarcode('');
    selectShelf('');
    resetSlipResult();
    resetActualSlipOcrFeedback();
    setOrderPlacementIntent('create_new_branch');
    setSelectedBranchId(null);
  }, [registerMessage, setTransferOrder, setTransferPart, setActualOrder, setActualPart,
    setActualFseiban, setOrderBarcode, selectShelf, resetSlipResult, resetActualSlipOcrFeedback,
    setOrderPlacementIntent, setSelectedBranchId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const pending = Boolean(transferOrder.trim() && actualOrder.trim()) &&
    (verified !== runSlipVerify || mp.slipVerifying);
  const result = transferOrder.trim() && actualOrder.trim() && !pending ? mp.slipResult : 'idle';
  const step: 'transferOrder' | 'actualOrder' | 'shelf' | 'register' = !transferOrder.trim() ? 'transferOrder'
    : !actualOrder.trim() || result === 'ng' ? 'actualOrder'
    : !mp.shelfCode.trim() ? 'shelf' : 'register';
  return { pending, result, step, toast };
}
