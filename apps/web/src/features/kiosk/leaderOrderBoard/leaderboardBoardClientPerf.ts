import { useCallback, useMemo, useRef } from 'react';

import { postKioskProductionScheduleLeaderboardClientPerf } from '../../../api/client';

const STORAGE_KEY = 'leaderboardBoardPerfLog';

export type LeaderboardBoardClientPerfDetailValue = string | number | boolean | null;

export type LeaderboardBoardClientPerfLogger = (
  event: string,
  detail?: Record<string, LeaderboardBoardClientPerfDetailValue>
) => void;

function sanitizeDetail(
  detail?: Record<string, LeaderboardBoardClientPerfDetailValue>
): Record<string, LeaderboardBoardClientPerfDetailValue> | undefined {
  if (!detail) return undefined;
  const out: Record<string, LeaderboardBoardClientPerfDetailValue> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string') {
      out[key] = value.length > 400 ? value.slice(0, 400) : value;
    } else if (typeof value === 'number') {
      out[key] = Number.isFinite(value) ? value : null;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `lb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isLeaderboardBoardClientPerfEnabled(): boolean {
  const env = import.meta.env.VITE_KIOSK_LEADERBOARD_BOARD_CLIENT_PERF_LOG;
  if (env === 'true' || env === '1') return true;
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  const flag = params.get('leaderboardPerf');
  if (flag === '1' || flag === 'true') {
    window.localStorage.setItem(STORAGE_KEY, '1');
    return true;
  }
  if (flag === '0' || flag === 'false') {
    window.localStorage.removeItem(STORAGE_KEY);
    return false;
  }
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

export function useLeaderboardBoardClientPerfLogger(context: {
  paramsKey: string;
  resourceCds: readonly string[];
}): LeaderboardBoardClientPerfLogger {
  const enabled = isLeaderboardBoardClientPerfEnabled();
  const sessionIdRef = useRef<string | null>(null);
  const startMsRef = useRef<number | null>(null);

  if (enabled && sessionIdRef.current == null) {
    sessionIdRef.current = createSessionId();
    startMsRef.current =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : 0;
  }

  const paramsKeyHash = useMemo(() => fnv1a(context.paramsKey), [context.paramsKey]);
  const resourceCds = useMemo(() => context.resourceCds.join(','), [context.resourceCds]);

  return useCallback<LeaderboardBoardClientPerfLogger>(
    (event, detail) => {
      if (!enabled || sessionIdRef.current == null) return;
      const markMs =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : 0;
      const elapsedMs = markMs - (startMsRef.current ?? markMs);
      const pagePath =
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : undefined;

      void postKioskProductionScheduleLeaderboardClientPerf({
        sessionId: sessionIdRef.current,
        event,
        pagePath,
        paramsKeyHash,
        resourceCds,
        markMs: Math.round(markMs),
        elapsedMs: Math.round(elapsedMs),
        detail: sanitizeDetail(detail)
      }).catch(() => {});
    },
    [enabled, paramsKeyHash, resourceCds]
  );
}
