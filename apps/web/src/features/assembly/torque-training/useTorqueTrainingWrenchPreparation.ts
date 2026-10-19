import { useCallback, useEffect, useRef, useState } from 'react';

import {
  prepareTorqueTrainingWrench,
  type TorqueTrainingWrenchPreparationResultApi
} from '../../../api/client';

export type TorqueTrainingWrenchPreparationStatus = 'idle' | 'registering' | 'registered';

export type TorqueTrainingWrenchPreparationInput = {
  uid: string;
};

export type UseTorqueTrainingWrenchPreparationResult = {
  status: TorqueTrainingWrenchPreparationStatus;
  result: TorqueTrainingWrenchPreparationResultApi | null;
  requestId: string | null;
  error: unknown | null;
  prepare: (input: TorqueTrainingWrenchPreparationInput) => Promise<TorqueTrainingWrenchPreparationResultApi>;
  reset: () => void;
};

function createPreparationRequestId(): string {
  return `training-wrench-preparation-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

/**
 * Owns the idempotent server preparation request independently of the local
 * torque-agent lease.  Once registration succeeds, retries only acquire the
 * local lease and never append another setting history row.
 */
export function useTorqueTrainingWrenchPreparation({
  sessionId,
  torqueWrenchProfileId
}: {
  sessionId: string | null;
  torqueWrenchProfileId: string | null;
}): UseTorqueTrainingWrenchPreparationResult {
  const [status, setStatus] = useState<TorqueTrainingWrenchPreparationStatus>('idle');
  const [result, setResult] = useState<TorqueTrainingWrenchPreparationResultApi | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const inFlightRef = useRef<Promise<TorqueTrainingWrenchPreparationResultApi> | null>(null);
  const identityRef = useRef(`${sessionId ?? ''}:${torqueWrenchProfileId ?? ''}`);

  const reset = useCallback(() => {
    requestIdRef.current = null;
    inFlightRef.current = null;
    setStatus('idle');
    setResult(null);
    setError(null);
  }, []);

  useEffect(() => {
    const nextIdentity = `${sessionId ?? ''}:${torqueWrenchProfileId ?? ''}`;
    if (identityRef.current === nextIdentity) return;
    identityRef.current = nextIdentity;
    reset();
  }, [reset, sessionId, torqueWrenchProfileId]);

  const prepare = useCallback(async (input: TorqueTrainingWrenchPreparationInput) => {
    if (!sessionId || !torqueWrenchProfileId) {
      throw new Error('訓練セッションと使用レンチを確認してください。');
    }
    if (result) return result;
    if (inFlightRef.current) return inFlightRef.current;

    const requestId = requestIdRef.current ?? createPreparationRequestId();
    requestIdRef.current = requestId;
    setStatus('registering');
    setError(null);
    const request = prepareTorqueTrainingWrench(sessionId, {
      uid: input.uid,
      torqueWrenchProfileId,
      requestId,
      physicalSettingConfirmed: true
    });
    inFlightRef.current = request;
    try {
      const next = await request;
      setResult(next);
      setStatus('registered');
      return next;
    } catch (cause) {
      setError(cause);
      setStatus('idle');
      throw cause;
    } finally {
      inFlightRef.current = null;
    }
  }, [result, sessionId, torqueWrenchProfileId]);

  return {
    status,
    result,
    requestId: requestIdRef.current,
    error,
    prepare,
    reset
  };
}
