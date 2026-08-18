import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createTorqueWrenchLocalLeaseToken,
  localhostTorqueWrenchTransport,
  sameTorqueWrenchLocalLeaseToken,
  TORQUE_CONNECTION_HEARTBEAT_INTERVAL_MS
} from './torqueWrenchConnectionTransport';

import type {
  TorqueAgentLeaseStatus,
  TorqueWrenchConnectionAcquireRequest,
  TorqueWrenchConnectionBinding,
  TorqueWrenchConnectionTargetKind,
  TorqueWrenchConnectionTakeoverRequest,
  TorqueWrenchConnectionTransport,
  TorqueWrenchLocalLeaseToken
} from './torqueWrenchConnectionTransport';

export type TorqueWrenchConnectionState =
  | 'available'
  | 'acquiring'
  | 'owned_by_self'
  | 'handoff_wait'
  | 'ready'
  | 'owned_by_other'
  | 'communication_lost'
  | 'recovering'
  | 'fenced';

export type TorqueWrenchConnectionReachability = 'unknown' | 'reachable' | 'unreachable';

export type TorqueWrenchConnectionContext = {
  targetKind: TorqueWrenchConnectionTargetKind;
  sessionId: string;
  currentTemplateBoltId: string | null;
  confirmationId: string;
  torqueWrenchProfileId: string;
};

export type TorqueWrenchConnectionReleaseOptions = {
  /**
   * Cleanup may only release the token it observed. A stale page callback
   * cannot release a newer generation after a takeover.
   */
  expectedToken?: TorqueWrenchLocalLeaseToken | null;
  keepalive?: boolean;
};

type UseTorqueWrenchConnectionOptions = {
  enabled: boolean;
  targetKind: TorqueWrenchConnectionTargetKind;
  sessionId: string | null;
  currentTemplateBoltId?: string | null;
  confirmationId: string | null;
  torqueWrenchProfileId: string | null;
  intervalMs?: number;
  transport?: TorqueWrenchConnectionTransport;
  onCommunicationLost?: (message: string) => void;
};

export type UseTorqueWrenchConnectionResult = {
  state: TorqueWrenchConnectionState;
  status: TorqueAgentLeaseStatus | null;
  token: TorqueWrenchLocalLeaseToken | null;
  reachability: TorqueWrenchConnectionReachability;
  busy: boolean;
  error: string | null;
  /** True after a remote owner/token mismatch; only an explicit action clears it. */
  requiresExplicitAcquire: boolean;
  leaseOwned: boolean;
  ready: boolean;
  binding: TorqueWrenchConnectionContext | null;
  acquire: (requestId?: string, bindingOverride?: TorqueWrenchConnectionContext) => Promise<TorqueAgentLeaseStatus | null>;
  takeover: (reason: string, requestId?: string) => Promise<TorqueAgentLeaseStatus | null>;
  release: (reason?: string, options?: TorqueWrenchConnectionReleaseOptions) => Promise<boolean>;
  clearError: () => void;
};

const COMMUNICATION_LOST_MESSAGE = 'torque-agentとの通信が切れました。接続状態を確認してください。';

function requestId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

function makeBinding(options: UseTorqueWrenchConnectionOptions): TorqueWrenchConnectionContext | null {
  if (!options.sessionId) return null;
  // Assembly keeps a heartbeat/disarm channel alive after the last bolt has
  // been completed. There is intentionally no physical confirmation in that
  // state, so use an empty binding only for that non-acquirable boundary. A
  // pre-confirmation assembly session and training still use health polling.
  if (
    (!options.confirmationId || !options.torqueWrenchProfileId)
    && !(options.targetKind === 'assembly' && options.currentTemplateBoltId === null)
  ) return null;
  return {
    targetKind: options.targetKind,
    sessionId: options.sessionId,
    currentTemplateBoltId: options.currentTemplateBoltId ?? null,
    confirmationId: options.confirmationId ?? '',
    torqueWrenchProfileId: options.torqueWrenchProfileId ?? ''
  };
}

function bindingKey(binding: TorqueWrenchConnectionContext | null): string {
  if (!binding) return '';
  return [
    binding.targetKind,
    binding.sessionId,
    binding.currentTemplateBoltId ?? '',
    binding.confirmationId,
    binding.torqueWrenchProfileId
  ].join(':');
}

function deriveState(status: TorqueAgentLeaseStatus): TorqueWrenchConnectionState {
  if (status.lastError === 'TORQUE_WRENCH_LEASE_FENCED' || status.state === 'fenced') return 'fenced';
  if (status.state === 'communication_lost') return 'communication_lost';
  if (status.state === 'owned_by_other') return 'owned_by_other';
  if (status.state === 'handoff_wait') return 'handoff_wait';
  if (status.state === 'ready' || (status.state === 'owned_by_self' && status.ready)) return 'ready';
  if (status.state === 'owned_by_self') return 'owned_by_self';
  // `expired` is a server-side detail, not an action the operator can use.
  // Treat it as available so the next click is an explicit acquire.
  return 'available';
}

function statusTokenMatches(
  status: TorqueAgentLeaseStatus,
  token: TorqueWrenchLocalLeaseToken,
  binding: TorqueWrenchConnectionBinding
): boolean {
  const statusToken = createTorqueWrenchLocalLeaseToken(status, binding);
  return statusToken ? sameTorqueWrenchLocalLeaseToken(statusToken, token) : true;
}

function isTokenMismatch(
  status: TorqueAgentLeaseStatus,
  token: TorqueWrenchLocalLeaseToken | null,
  binding: TorqueWrenchConnectionBinding
): boolean {
  const statusHasToken = Boolean(
    status.selfOwnedToken?.leaseId
    || status.selfOwnedToken?.generation
    || status.selfOwnedToken?.sessionId
    || status.selfOwnedToken?.torqueWrenchProfileId
    || status.selfOwnedToken?.targetKind
    || status.leaseToken?.leaseId
    || status.token?.leaseId
    || status.leaseId
  );
  return Boolean(token && statusHasToken && !statusTokenMatches(status, token, binding));
}

function toBindingPayload(binding: TorqueWrenchConnectionBinding): TorqueWrenchConnectionBinding {
  return {
    targetKind: binding.targetKind,
    sessionId: binding.sessionId,
    currentTemplateBoltId: binding.currentTemplateBoltId,
    confirmationId: binding.confirmationId,
    torqueWrenchProfileId: binding.torqueWrenchProfileId
  };
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.includes('torque-agent')) return COMMUNICATION_LOST_MESSAGE;
  return COMMUNICATION_LOST_MESSAGE;
}

export function useTorqueWrenchConnection({
  enabled,
  targetKind,
  sessionId,
  currentTemplateBoltId = null,
  confirmationId,
  torqueWrenchProfileId,
  intervalMs = TORQUE_CONNECTION_HEARTBEAT_INTERVAL_MS,
  transport = localhostTorqueWrenchTransport,
  onCommunicationLost
}: UseTorqueWrenchConnectionOptions): UseTorqueWrenchConnectionResult {
  const binding = useMemo(
    () => makeBinding({
      enabled,
      targetKind,
      sessionId,
      currentTemplateBoltId,
      confirmationId,
      torqueWrenchProfileId,
      intervalMs,
      transport,
      onCommunicationLost
    }),
    [confirmationId, currentTemplateBoltId, enabled, intervalMs, onCommunicationLost, sessionId, targetKind, torqueWrenchProfileId, transport]
  );
  const bindingIdentity = bindingKey(binding);
  const bindingRef = useRef<TorqueWrenchConnectionContext | null>(binding);
  const transportRef = useRef(transport);
  const tokenRef = useRef<TorqueWrenchLocalLeaseToken | null>(null);
  const statusRef = useRef<TorqueAgentLeaseStatus | null>(null);
  const stateRef = useRef<TorqueWrenchConnectionState>('available');
  const busyRef = useRef(false);
  const releaseInFlightRef = useRef(false);
  const releaseRef = useRef<UseTorqueWrenchConnectionResult['release'] | null>(null);
  const lastBindingKeyRef = useRef(bindingIdentity);
  const [state, setState] = useState<TorqueWrenchConnectionState>('available');
  const [status, setStatus] = useState<TorqueAgentLeaseStatus | null>(null);
  const [token, setToken] = useState<TorqueWrenchLocalLeaseToken | null>(null);
  const [reachability, setReachability] = useState<TorqueWrenchConnectionReachability>('unknown');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requiresExplicitAcquire, setRequiresExplicitAcquire] = useState(false);

  bindingRef.current = binding;
  transportRef.current = transport;

  const setConnectionState = useCallback((next: TorqueWrenchConnectionState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const setLocalToken = useCallback((next: TorqueWrenchLocalLeaseToken | null) => {
    tokenRef.current = next;
    setToken(next);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const acceptStatus = useCallback((
    next: TorqueAgentLeaseStatus,
    fromAction = false,
    bindingOverride?: TorqueWrenchConnectionContext
  ) => {
    const currentBinding = bindingOverride ?? bindingRef.current;
    if (!currentBinding) {
      statusRef.current = next;
      setStatus(next);
      setLocalToken(null);
      setReachability('reachable');
      setError(null);
      setConnectionState(deriveState(next));
      return;
    }
    const currentToken = tokenRef.current;
    const mismatch = isTokenMismatch(next, currentToken, currentBinding);
    const nextToken = createTorqueWrenchLocalLeaseToken(next, currentBinding);
    const nextState = deriveState(next);
    statusRef.current = next;
    setStatus(next);
    setReachability('reachable');
    setError(null);

    if (mismatch) {
      // Never preserve a token when the agent reports another generation.
      setLocalToken(null);
      setRequiresExplicitAcquire(true);
      setConnectionState(nextState === 'owned_by_other' ? 'owned_by_other' : 'available');
      return;
    }

    if (nextState === 'owned_by_other') {
      setLocalToken(null);
      setRequiresExplicitAcquire(true);
      setConnectionState('owned_by_other');
      return;
    }
    if (nextState === 'fenced') {
      setLocalToken(null);
      setRequiresExplicitAcquire(true);
      setConnectionState('fenced');
      return;
    }

    // Owner-only token fields are optional for compatibility with the
    // original localhost agent, which keeps the opaque token inside itself.
    // A token is never fabricated in the browser.
    if (nextToken) setLocalToken(nextToken);
    if (fromAction) setRequiresExplicitAcquire(false);

    const recovering = stateRef.current === 'communication_lost'
      && (nextState === 'owned_by_self' || nextState === 'ready')
      && (!currentToken || !nextToken || sameTorqueWrenchLocalLeaseToken(currentToken, nextToken));
    if (recovering) {
      setConnectionState('recovering');
      return;
    }
    setConnectionState(nextState);
  }, [setConnectionState, setLocalToken]);

  const release = useCallback(async (
    reason = 'OPERATOR_RELEASE',
    options: TorqueWrenchConnectionReleaseOptions = {}
  ): Promise<boolean> => {
    const currentToken = tokenRef.current;
    const expectedToken = options.expectedToken;
    if (expectedToken && !sameTorqueWrenchLocalLeaseToken(currentToken, expectedToken)) {
      // The page that requested cleanup no longer owns this generation.
      return false;
    }
    // The agent owns the opaque generation token. Do not issue a tokenless
    // release from a stale browser page; an owner cleanup is valid only when
    // the full local token is still present and matches the optional guard.
    if (!currentToken) return false;
    if (releaseInFlightRef.current) return false;
    releaseInFlightRef.current = true;
    try {
      const next = await transportRef.current.release({
        reason,
        token: currentToken,
        keepalive: options.keepalive
      });
      statusRef.current = next;
      setStatus(next);
      setReachability('reachable');
      setError(null);
      setLocalToken(null);
      setRequiresExplicitAcquire(false);
      setConnectionState(next.owner && next.state === 'owned_by_other' ? 'owned_by_other' : 'available');
      return true;
    } catch (cause) {
      const message = errorMessage(cause);
      setReachability('unreachable');
      setError(message);
      setConnectionState('communication_lost');
      onCommunicationLost?.(message);
      return false;
    } finally {
      releaseInFlightRef.current = false;
    }
  }, [onCommunicationLost, setConnectionState, setLocalToken]);

  releaseRef.current = release;

  const runAcquire = useCallback(async (
    takeover: boolean,
    takeoverReason: string | null,
    explicitRequestId?: string,
    bindingOverride?: TorqueWrenchConnectionContext
  ): Promise<TorqueAgentLeaseStatus | null> => {
    const currentBinding = bindingOverride ?? bindingRef.current;
    if (!currentBinding || busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setConnectionState(takeover ? 'acquiring' : 'acquiring');
    const request: TorqueWrenchConnectionAcquireRequest = {
      ...toBindingPayload(currentBinding),
      requestId: explicitRequestId ?? requestId(takeover ? 'torque-takeover' : 'torque-acquire')
    };
    try {
      const next = takeover
        ? await transportRef.current.takeover({
            ...request,
            physicalWrenchPresent: true,
            reason: takeoverReason?.trim() || 'physical wrench present'
          } satisfies TorqueWrenchConnectionTakeoverRequest)
        : await transportRef.current.acquire(request);
      acceptStatus(next, true, currentBinding);
      return next;
    } catch (cause) {
      const message = errorMessage(cause);
      setReachability('unreachable');
      setError(message);
      setConnectionState('communication_lost');
      onCommunicationLost?.(message);
      throw cause;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [acceptStatus, onCommunicationLost, setConnectionState]);

  const acquire = useCallback(
    (explicitRequestId?: string, bindingOverride?: TorqueWrenchConnectionContext) =>
      runAcquire(false, null, explicitRequestId, bindingOverride),
    [runAcquire]
  );

  const takeover = useCallback(
    (reason: string, explicitRequestId?: string) => runAcquire(true, reason, explicitRequestId),
    [runAcquire]
  );

  useEffect(() => {
    const nextKey = bindingIdentity;
    if (nextKey === lastBindingKeyRef.current) return;
    lastBindingKeyRef.current = nextKey;
    const oldToken = tokenRef.current;
    // A target/session/confirmation change is a page-level disarm boundary.
    // Release only the token that belonged to the previous binding.
    if (oldToken) {
      void releaseRef.current?.('BINDING_CHANGED', { expectedToken: oldToken, keepalive: true });
    }
    setLocalToken(null);
    setStatus(null);
    setRequiresExplicitAcquire(false);
    setReachability('unknown');
    setError(null);
    setConnectionState('available');
  }, [bindingIdentity, setConnectionState, setLocalToken]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    let requestController: AbortController | null = null;

    const poll = async () => {
      if (cancelled) return;
      const currentBinding = bindingRef.current;
      requestController = new AbortController();
      try {
        const next = currentBinding
          ? await transportRef.current.heartbeat(toBindingPayload(currentBinding), requestController.signal)
          : await transportRef.current.health(requestController.signal);
        if (cancelled) return;
        acceptStatus(next);
      } catch (cause) {
        if (cancelled) return;
        const message = errorMessage(cause);
        setReachability('unreachable');
        setError(message);
        setConnectionState('communication_lost');
        onCommunicationLost?.(message);
      } finally {
        requestController = null;
        if (!cancelled) timer = window.setTimeout(() => void poll(), intervalMs);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      requestController?.abort();
    };
  }, [acceptStatus, bindingIdentity, enabled, intervalMs, onCommunicationLost, setConnectionState]);

  useEffect(() => {
    if (enabled) return;
    const oldToken = tokenRef.current;
    if (oldToken) {
      void releaseRef.current?.('PAGE_DISABLED', { expectedToken: oldToken, keepalive: true });
    }
  }, [enabled]);

  useEffect(() => () => {
    const oldToken = tokenRef.current;
    if (oldToken) {
      void releaseRef.current?.('PAGE_LEFT', { expectedToken: oldToken, keepalive: true });
    }
  }, []);

  const leaseOwned = Boolean(
    status?.leaseOwned
    && (state === 'owned_by_self' || state === 'handoff_wait' || state === 'ready' || state === 'recovering')
  );

  return {
    state,
    status,
    token,
    reachability,
    busy,
    error,
    requiresExplicitAcquire,
    leaseOwned,
    ready: state === 'ready',
    binding,
    acquire,
    takeover,
    release,
    clearError
  };
}
