import { useCallback, useEffect, useMemo, useState } from 'react';

import { getAssemblyWorkSessionProcedureSequence } from '../../api/client';

import { readAssemblyApiErrorMessage } from './assemblyUiHelpers';

import type { AssemblyProcedureSequenceDto } from './types';

export type AssemblyWorkProcedureSequenceState =
  | { status: 'idle'; sequence: null; error: null }
  | { status: 'loading'; sequence: null; error: null }
  | { status: 'ready'; sequence: AssemblyProcedureSequenceDto; error: null }
  | { status: 'error'; sequence: null; error: string };

type StoredState = AssemblyWorkProcedureSequenceState & {
  sessionId: string | null;
  revision: number;
};

type Options = {
  sessionId: string | null;
  enabled: boolean;
};

const idleState: AssemblyWorkProcedureSequenceState = {
  status: 'idle',
  sequence: null,
  error: null
};

export function useAssemblyWorkProcedureSequence({ sessionId, enabled }: Options): {
  state: AssemblyWorkProcedureSequenceState;
  retry: () => void;
} {
  const [revision, setRevision] = useState(0);
  const [storedState, setStoredState] = useState<StoredState>({
    ...idleState,
    sessionId: null,
    revision: 0
  });

  const retry = useCallback(() => {
    if (!enabled || !sessionId) return;
    setRevision((current) => current + 1);
  }, [enabled, sessionId]);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    let cancelled = false;
    setStoredState({
      status: 'loading',
      sequence: null,
      error: null,
      sessionId,
      revision
    });
    void getAssemblyWorkSessionProcedureSequence(sessionId)
      .then((sequence) => {
        if (cancelled) return;
        setStoredState({
          status: 'ready',
          sequence,
          error: null,
          sessionId,
          revision
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStoredState({
          status: 'error',
          sequence: null,
          error: readAssemblyApiErrorMessage(error, '要領書の取得に失敗しました。'),
          sessionId,
          revision
        });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, revision, sessionId]);

  const state = useMemo<AssemblyWorkProcedureSequenceState>(() => {
    if (!enabled || !sessionId) return idleState;
    if (storedState.sessionId !== sessionId || storedState.revision !== revision) {
      return {
        status: 'loading',
        sequence: null,
        error: null
      };
    }
    if (storedState.status === 'ready') {
      return {
        status: 'ready',
        sequence: storedState.sequence,
        error: null
      };
    }
    if (storedState.status === 'error') {
      return {
        status: 'error',
        sequence: null,
        error: storedState.error
      };
    }
    return {
      status: storedState.status,
      sequence: null,
      error: null
    };
  }, [enabled, revision, sessionId, storedState]);

  return { state, retry };
}
