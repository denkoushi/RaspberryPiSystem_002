import { useCallback, useEffect, useRef, useState } from 'react';

import {
  acquireAssemblyProcedureDocumentEditLease,
  readAssemblyProcedureDocumentEditLock,
  releaseAssemblyProcedureDocumentEditLease,
  type AssemblyProcedureDocumentEditLease
} from '../../../api/domains/assembly-edit-lease';

export function useAssemblyProcedureDocumentEditLease(input: {
  documentId: string;
  enabled: boolean;
  onLost: (lease: AssemblyProcedureDocumentEditLease) => void;
  onError: () => void;
}) {
  const [lease, setLease] = useState<AssemblyProcedureDocumentEditLease | null>(null);
  const [holderToken, setHolderToken] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [pending, setPending] = useState(false);
  const mineRef = useRef(false);
  const callbacks = useRef(input);
  callbacks.current = input;
  const acquireRef = useRef<(takeover?: boolean) => Promise<void>>(async () => undefined);
  // Keep an old effect's release ahead of a new effect's acquisition.
  const operations = useRef<Promise<unknown>>(Promise.resolve());

  const handleError = useCallback((error: unknown) => {
    const locked = readAssemblyProcedureDocumentEditLock(error);
    if (!locked) return false;
    if (mineRef.current) callbacks.current.onLost(locked);
    mineRef.current = false;
    setMine(false);
    setHolderToken(null);
    setLease(locked);
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let hidden = false;
    let inFlight = false;
    mineRef.current = false;
    setMine(false);
    setLease(null);
    setHolderToken(null);
    let sessionToken: string | null = null;
    if (!input.enabled) return;

    const release = () => {
      if (!mineRef.current) return;
      mineRef.current = false;
      const releasedToken = sessionToken;
      sessionToken = null;
      setHolderToken(null);
      operations.current = operations.current.then(() => releaseAssemblyProcedureDocumentEditLease(input.documentId, releasedToken)).catch(() => undefined);
    };
    const acquire = async (takeover = false) => {
      if (cancelled || hidden || inFlight) return;
      inFlight = true;
      setPending(true);
      const operation = operations.current.then(async () => {
        try {
          if (cancelled || hidden) return;
          const result = await acquireAssemblyProcedureDocumentEditLease(input.documentId, takeover, sessionToken);
          if (cancelled || hidden) {
            if (result.mine) await releaseAssemblyProcedureDocumentEditLease(input.documentId, result.holderToken).catch(() => undefined);
            return;
          }
          sessionToken = result.holderToken;
          setHolderToken(result.holderToken);
          mineRef.current = result.mine;
          setMine(result.mine);
          setLease(result.lease);
        } catch (error: unknown) {
          if (cancelled || hidden) return;
          if (!handleError(error)) {
            mineRef.current = false;
            setMine(false);
            callbacks.current.onError();
          }
        } finally {
          inFlight = false;
          if (!cancelled) setPending(false);
        }
      });
      operations.current = operation;
      await operation;
    };
    acquireRef.current = acquire;
    void acquire();
    const timer = window.setInterval(() => {
      if (mineRef.current) void acquire();
    }, 30_000);
    const pagehide = () => {
      hidden = true;
      release();
      setMine(false);
    };
    const pageshow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      hidden = false;
      void acquire();
    };
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      release();
    };
  }, [handleError, input.documentId, input.enabled]);

  const takeover = useCallback(() => acquireRef.current(true), []);
  const retry = useCallback(() => acquireRef.current(), []);
  return { lease, holderToken, mine, pending, takeover, retry, handleError };
}
