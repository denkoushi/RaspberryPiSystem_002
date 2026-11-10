import { normalizeSlipToken } from '@raspi-system/slip-match-core';
import { useEffect, useRef, useState } from 'react';

import type { MobilePlacementSlipMatchResponse } from '../../../api/domains/mobile-placement';
import type { useMobilePlacementPageState } from '../useMobilePlacementPageState';

export type HaizenState = ReturnType<typeof useMobilePlacementPageState>;

/** Serialize automatic verification so an older response cannot overwrite the latest pair. */
export function useHaizenWorkflow(mp: HaizenState, enabled = true, verifiedPart?: { productNo: string; fseiban: string; fhincd: string; fhinmei: string }) {
  const { transferOrder, actualOrder, actualFseiban, runSlipVerify, setOrderBarcode, scanField } = mp;
  const [retryCount, setRetryCount] = useState(0);
  const queue = useRef(Promise.resolve());
  const [verified, setVerified] = useState<typeof runSlipVerify | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => { if (enabled) setOrderBarcode(transferOrder); }, [enabled, transferOrder, setOrderBarcode]);

  useEffect(() => {
    let current = true;
    setVerified(null);
    if (enabled && transferOrder.trim() && (actualOrder.trim() || actualFseiban.trim()) && scanField === null && !mp.actualSlipImageOcrBusy) {
      queue.current = queue.current.then(async () => {
        if (!current) return;
        await runSlipVerify();
        if (current) setVerified(() => runSlipVerify);
      });
    }
    return () => { current = false; };
  }, [retryCount, enabled, transferOrder, actualOrder, actualFseiban, runSlipVerify, scanField, mp.actualSlipImageOcrBusy]);

  const {
    registerMessage, setTransferOrder, setTransferPart, setActualOrder, setActualPart,
    setActualFseiban, selectShelf, resetSlipResult, resetActualSlipOcrFeedback,
    setOrderPlacementIntent, setSelectedBranchId
  } = mp;
  useEffect(() => {
    if (!registerMessage) return;
    setToast(registerMessage);
    if (!enabled) return;
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
  }, [enabled, registerMessage, setTransferOrder, setTransferPart, setActualOrder, setActualPart,
    setActualFseiban, setOrderBarcode, selectShelf, resetSlipResult, resetActualSlipOcrFeedback,
    setOrderPlacementIntent, setSelectedBranchId]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // This part already has a saved match; a fresh transfer scan identifies it without fabricating another verification record.
  const resumed = enabled && Boolean(verifiedPart && transferOrder.trim() && !actualOrder.trim() && !actualFseiban.trim() &&
    scanField === null && normalizeSlipToken(transferOrder) === normalizeSlipToken(verifiedPart.productNo));
  const details: MobilePlacementSlipMatchResponse | null = resumed && verifiedPart ? { ok: true, reason: 'match' as const,
    expected: { fseiban: verifiedPart.fseiban, fhincd: verifiedPart.fhincd, partName: verifiedPart.fhinmei } } : mp.slipDetails;
  const pending = Boolean(enabled && transferOrder.trim() && (actualOrder.trim() || actualFseiban.trim())) &&
    (verified !== runSlipVerify || mp.slipVerifying);
  const result = enabled && transferOrder.trim() && (actualOrder.trim() || actualFseiban.trim()) && !pending ? mp.slipResult : 'idle';
  return { pending: resumed ? false : pending, result: resumed ? 'ok' as const : result, details, resumed, toast, retry: () => setRetryCount((n) => n + 1) };
}
