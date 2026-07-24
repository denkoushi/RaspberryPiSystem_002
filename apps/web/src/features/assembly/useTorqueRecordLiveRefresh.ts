import { useEffect, useRef } from 'react';

import { TORQUE_AGENT_STREAM_URL } from './torqueAgentClient';

export type TorqueRecordCommittedPayload = {
  type: 'torqueRecordCommitted';
  sessionId: string;
  sourceEventKey: string;
  capturedAt?: string | null;
  acknowledgedAt: string;
};

type UseTorqueRecordLiveRefreshOptions<T> = {
  enabled: boolean;
  sessionId: string | null;
  knownSourceEventKeys: ReadonlySet<string>;
  loadSession: (sessionId: string) => Promise<T>;
  onSessionLoaded: (session: T) => void;
  pollIntervalMs?: number;
  reconnectIntervalMs?: number;
  wsUrl?: string;
};

function isCommittedPayload(value: unknown): value is TorqueRecordCommittedPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TorqueRecordCommittedPayload>;
  return candidate.type === 'torqueRecordCommitted'
    && typeof candidate.sessionId === 'string'
    && typeof candidate.sourceEventKey === 'string'
    && typeof candidate.acknowledgedAt === 'string';
}

export function useTorqueRecordLiveRefresh<T>({
  enabled,
  sessionId,
  knownSourceEventKeys,
  loadSession,
  onSessionLoaded,
  pollIntervalMs = 1200,
  reconnectIntervalMs = 2000,
  wsUrl = TORQUE_AGENT_STREAM_URL
}: UseTorqueRecordLiveRefreshOptions<T>) {
  const knownSourceEventKeysRef = useRef(knownSourceEventKeys);
  const loadSessionRef = useRef(loadSession);
  const onSessionLoadedRef = useRef(onSessionLoaded);
  knownSourceEventKeysRef.current = knownSourceEventKeys;
  loadSessionRef.current = loadSession;
  onSessionLoadedRef.current = onSessionLoaded;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    let cancelled = false;
    let inFlight = false;
    let pending = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const notifiedEventKeys = new Set<string>();

    const refresh = async () => {
      if (cancelled) return;
      if (inFlight) {
        pending = true;
        return;
      }

      inFlight = true;
      try {
        do {
          pending = false;
          try {
            const next = await loadSessionRef.current(sessionId);
            if (!cancelled) onSessionLoadedRef.current(next);
          } catch {
            // The next poll or committed notification retries the authoritative read.
          }
        } while (!cancelled && pending);
      } finally {
        inFlight = false;
      }
    };

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(wsUrl);
        socket.onmessage = (message) => {
          if (cancelled) return;
          try {
            const payload: unknown = JSON.parse(String(message.data));
            if (!isCommittedPayload(payload) || payload.sessionId !== sessionId) return;
            if (
              notifiedEventKeys.has(payload.sourceEventKey)
              || knownSourceEventKeysRef.current.has(payload.sourceEventKey)
            ) {
              return;
            }
            notifiedEventKeys.add(payload.sourceEventKey);
            void refresh();
          } catch {
            // Ignore malformed local notifications; polling remains authoritative.
          }
        };
        socket.onclose = () => {
          if (!cancelled) reconnectTimer = setTimeout(connect, reconnectIntervalMs);
        };
        socket.onerror = () => {
          // Reconnect from onclose. The fallback poll continues independently.
        };
      } catch {
        if (!cancelled) reconnectTimer = setTimeout(connect, reconnectIntervalMs);
      }
    };

    connect();
    const pollTimer = window.setInterval(() => void refresh(), pollIntervalMs);

    return () => {
      cancelled = true;
      socket?.close();
      window.clearInterval(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [enabled, pollIntervalMs, reconnectIntervalMs, sessionId, wsUrl]);
}
