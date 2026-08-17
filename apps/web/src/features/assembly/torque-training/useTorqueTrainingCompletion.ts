import { useEffect, useRef } from 'react';

type UseTorqueTrainingCompletionOptions = {
  sessionId: string | null;
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | null;
  hasLocalLease: boolean;
  releaseLocalLease: (reason: string) => Promise<unknown>;
  onCompleted: () => void;
};

export function useTorqueTrainingCompletion({
  sessionId,
  status,
  hasLocalLease,
  releaseLocalLease,
  onCompleted
}: UseTorqueTrainingCompletionOptions): void {
  const handledSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || status !== 'COMPLETED' || handledSessionIdRef.current === sessionId) return;

    handledSessionIdRef.current = sessionId;
    if (hasLocalLease) void releaseLocalLease('TRAINING_COMPLETED').catch(() => undefined);
    onCompleted();
  }, [hasLocalLease, onCompleted, releaseLocalLease, sessionId, status]);
}
