import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import { api, getResolvedClientKey } from '../../../../api/client';

import { createPlanningBoardConnectivity } from './planningBoardConnectivity';
import { PlanningBoardConnectivityBanner } from './PlanningBoardConnectivityBanner';
import { DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG } from './planningBoardOfflineConfig';
import { createPlanningBoardWriteGate, passThroughPlanningBoardWriteGate } from './planningBoardWriteGate';

import type { BoardConnectivitySnapshot } from './planningBoardConnectivity';
import type { BoardOfflineConfig } from './planningBoardOfflineConfig';
import type { ReactNode } from 'react';

export type BoardReadParticipant = {
  read(signal: AbortSignal): Promise<unknown>;
  commit(data: unknown): void;
};
const disabledSnapshot: BoardConnectivitySnapshot = { phase: 'online', generation: 0, recoveredUntil: null };
const noop = () => undefined;
const disabled = {
  enabled: false, frozen: false, snapshot: disabledSnapshot, gate: passThroughPlanningBoardWriteGate,
  displayedAt: null as number | null, now: () => Date.now(), notification: null as string | null,
  registerRead: (_key: string, _participant: BoardReadParticipant): (() => void) => noop,
  stagedRead: (_key: string): unknown => undefined,
  reportRead: (_generation: number, _date: string | undefined): void => undefined,
  publishRead: (_generation: number): void => undefined,
  refreshRead: async (_key: string): Promise<void> => undefined,
  subscribeFreeze: (_listener: () => void): (() => void) => noop
};
const OfflineContext = createContext(disabled);
export const usePlanningBoardOffline = () => useContext(OfflineContext);

/** Hold the last rendered projection, including optimistic overlays, across read-only generations. */
export function useFrozenValue<T>(value: T): T {
  const { frozen } = usePlanningBoardOffline();
  const last = useRef(value);
  if (!frozen) last.current = value;
  return frozen ? last.current : value;
}

export function PlanningBoardOfflineProvider({ children, config = DEFAULT_PLANNING_BOARD_OFFLINE_CONFIG }: {
  children: ReactNode; config?: BoardOfflineConfig;
}) {
  return config.enabled ? <EnabledProvider config={config}>{children}</EnabledProvider> : <>{children}</>;
}

function EnabledProvider({ children, config }: { children: ReactNode; config: BoardOfflineConfig }) {
  const [notification, setNotification] = useState<string | null>(null);
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [displayedAt, setDisplayedAt] = useState<number | null>(null);
  const initialRenderTime = useRef(Date.now());
  const lifecycle = useRef(0);
  const lastReadDate = useRef<number | null>(null);
  const clock = useRef<{ server: number; mono: number } | undefined>(undefined);
  const activeReads = useRef(new Set<AbortController>());
  const reads = useRef(new Map<string, BoardReadParticipant>());
  const staged = useRef(new Map<string, unknown>());
  const freezeListeners = useRef(new Set<() => void>());
  const identity = useRef(getResolvedClientKey());
  const retryBootstrap = useRef<() => void>(noop);
  const runtime = useMemo(() => {
    const controller = createPlanningBoardConnectivity({ config, onBootstrapProbeSuccess: () => retryBootstrap.current(), probe: async (signal) => {
      if (identity.current !== getResolvedClientKey()) return false;
      const response = await api.get('/kiosk/production-schedule/grinding-planning-board/resource-capacity', {
        signal, timeout: config.probeTimeoutMs, params: { _probe: performance.now() },
        headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' }, kioskTelemetry: 'background'
      });
      if (identity.current !== getResolvedClientKey()) return false;
      const finalUrl = response.request?.responseURL as string | undefined;
      if (finalUrl && !new URL(finalUrl, window.location.origin).pathname.endsWith('/kiosk/production-schedule/grinding-planning-board/resource-capacity')) return false;
      const data = response.data;
      return response.status >= 200 && response.status < 300 && !!data &&
        typeof data.dailyHoursByResource === 'object' && data.dailyHoursByResource !== null && !Array.isArray(data.dailyHoursByResource) &&
        Object.values(data.dailyHoursByResource).every((value) => typeof value === 'number' && [8, 10, 24].includes(value)) &&
        Array.isArray(data.runsThroughBreaksResources) && data.runsThroughBreaksResources.every((value: unknown) => typeof value === 'string');
    } });
    const gate = createPlanningBoardWriteGate(
      () => { controller.checkElapsed(); return controller.isRunning() && controller.getSnapshot().phase === 'online' && identity.current === getResolvedClientKey(); },
      () => controller.getSnapshot().generation,
      () => {
        clearTimeout(notificationTimer.current);
        setNotification('圏外のため操作できません');
        notificationTimer.current = setTimeout(() => setNotification(null), 2000);
      }
    );
    let previous = controller.getSnapshot().phase;
    controller.subscribe(() => {
      const next = controller.getSnapshot().phase;
      if (next === 'offline' && previous !== 'offline') {
        freezeListeners.current.forEach((listener) => listener());
        activeReads.current.forEach((abort) => abort.abort());
        gate.close();
      }
      previous = next;
    });
    return { controller, gate };
  }, [config]);
  const { controller, gate } = runtime;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const frozen = snapshot.phase === 'offline' || snapshot.phase === 'refreshing';
  const frozenNow = useRef<number | null>(null);
  const serverNow = () => clock.current ? clock.current.server + performance.now() - clock.current.mono : null;
  const value = useMemo(() => ({
    enabled: true, frozen, snapshot, gate, displayedAt, notification,
    now: () => {
      if (controller.getSnapshot().phase === 'online') return serverNow() ?? initialRenderTime.current;
      return frozenNow.current ?? clock.current?.server ?? initialRenderTime.current;
    },
    registerRead: (key: string, participant: BoardReadParticipant) => {
      reads.current.set(key, participant);
      return () => { if (reads.current.get(key) === participant) reads.current.delete(key); };
    },
    stagedRead: (key: string) => staged.current.get(key),
    reportRead: (generation: number, date: string | undefined) => {
      if (generation !== controller.getSnapshot().generation || identity.current !== getResolvedClientKey()) return;
      controller.reportBoardReadSuccess(generation);
      if (generation !== controller.getSnapshot().generation) return;
      const parsed = date ? Date.parse(date) : NaN;
      lastReadDate.current = Number.isFinite(parsed) ? parsed : null;
      if (Number.isFinite(parsed)) {
        clock.current = { server: parsed, mono: performance.now() };
      }
    },
    publishRead: (generation: number) => {
      if (generation === controller.getSnapshot().generation && identity.current === getResolvedClientKey()) setDisplayedAt(lastReadDate.current);
    },
    refreshRead: async (key: string) => {
      if (!gate.canWrite()) return;
      const participant = reads.current.get(key); if (!participant) return;
      const generation = gate.generation(); const abort = new AbortController();
      activeReads.current.add(abort);
      const timeout = setTimeout(() => abort.abort(), config.lossAfterMs);
      try {
        const data = await participant.read(abort.signal);
        if (!abort.signal.aborted && generation === gate.generation() && identity.current === getResolvedClientKey() && reads.current.get(key) === participant) participant.commit(data);
      } finally { clearTimeout(timeout); activeReads.current.delete(abort); }
    },
    subscribeFreeze: (listener: () => void) => {
      freezeListeners.current.add(listener);
      return () => { freezeListeners.current.delete(listener); };
    }
  }), [frozen, snapshot, gate, displayedAt, notification, controller, config.lossAfterMs]);
  useEffect(() => {
    const lifecycleRef = lifecycle;
    const listeners = freezeListeners.current;
    const active = activeReads.current;
    const epoch = ++lifecycleRef.current;
    const freeze = () => { frozenNow.current = serverNow() ?? initialRenderTime.current; };
    freezeListeners.current.add(freeze);
    controller.start(navigator.onLine === false);
    const probe = () => controller.probeNow();
    window.addEventListener('online', probe);
    window.addEventListener('offline', probe);
    return () => {
      void Promise.resolve().then(() => { if (lifecycleRef.current === epoch) { controller.stop(); gate.close(); } });
      listeners.delete(freeze);
      active.forEach((abort) => abort.abort());
      clearTimeout(notificationTimer.current);
      window.removeEventListener('online', probe);
      window.removeEventListener('offline', probe);
    };
  }, [controller, gate]);
  useEffect(() => {
    if (snapshot.phase !== 'bootstrapping' && snapshot.phase !== 'refreshing') return;
    let active: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let complete = false;
    let disposed = false;
    let retryAfter = 0;
    const run = () => {
      if (disposed || active || complete || performance.now() < retryAfter) return;
      const abort = new AbortController();
      active = abort;
      retryAfter = performance.now() + config.probeIntervalMs;
      let reported = false;
      const report = (success: boolean) => {
        if (reported) return;
        reported = true;
        controller.reportFullRefresh(snapshot.generation, success);
      };
      timeout = setTimeout(() => { abort.abort(); report(false); }, config.lossAfterMs);
      void (async () => {
        try {
          await gate.waitForIdle(abort.signal);
          staged.current.clear();
          // The board is staged first so dependent process chips use the replacement's parts.
          const entries = [...reads.current].sort(([a], [b]) => Number(b === 'board') - Number(a === 'board'));
          for (const [key, participant] of entries) {
            const result = await participant.read(abort.signal);
            if (abort.signal.aborted || controller.getSnapshot().generation !== snapshot.generation || identity.current !== getResolvedClientKey()) return;
            staged.current.set(key, result);
          }
          if (!entries.some(([key]) => key === 'board')) throw new Error('Missing board');
          complete = true;
          flushSync(() => {
            for (const [key, participant] of entries) participant.commit(staged.current.get(key));
            setDisplayedAt(lastReadDate.current);
            frozenNow.current = null;
            report(true);
          });
        } catch { report(false); }
        finally { clearTimeout(timeout); active = undefined; if (!reported) report(false); }
      })();
    };
    if (snapshot.phase === 'bootstrapping') retryBootstrap.current = run;
    run();
    return () => {
      disposed = true;
      retryBootstrap.current = noop;
      clearTimeout(timeout);
      active?.abort();
      if (!complete) controller.reportFullRefresh(snapshot.generation, false);
    };
  }, [snapshot.phase, snapshot.generation, config.lossAfterMs, config.probeIntervalMs, controller, gate]);
  return <OfflineContext.Provider value={value}>
    {children}
    <PlanningBoardConnectivityBanner phase={snapshot.phase} displayedAt={displayedAt} recoveredUntil={snapshot.recoveredUntil} />
  </OfflineContext.Provider>;
}
