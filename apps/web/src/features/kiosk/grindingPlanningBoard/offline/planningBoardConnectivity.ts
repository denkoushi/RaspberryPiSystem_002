import type { BoardOfflineConfig } from './planningBoardOfflineConfig';

export type BoardConnectivityPhase = 'bootstrapping' | 'online' | 'offline' | 'refreshing';
export type BoardConnectivitySnapshot = Readonly<{
  phase: BoardConnectivityPhase;
  generation: number;
  /** Monotonic deadline, never a wall-clock timestamp. Null on initial startup. */
  recoveredUntil: number | null;
}>;

type Options = {
  config: BoardOfflineConfig;
  now?: () => number;
  /** Resolve true only for a timely 2xx response with the expected JSON shape. */
  probe: (signal: AbortSignal) => Promise<boolean>;
};

/** Independent, terminal-on-stop controller. The caller owns browser event subscriptions. */
export function createPlanningBoardConnectivity({ config, probe, now = () => performance.now() }: Options) {
  let snapshot: BoardConnectivitySnapshot = Object.freeze({ phase: 'bootstrapping', generation: 0, recoveredUntil: null });
  const listeners = new Set<() => void>();
  let started = false;
  let stopped = false;
  let lastSuccess = 0;
  let successes = 0;
  let bootstrapComplete = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let lossTimer: ReturnType<typeof setTimeout> | undefined;
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  let active: { controller: AbortController; timeout: ReturnType<typeof setTimeout>; generation: number; deadline: number } | undefined;

  const publish = (next: BoardConnectivitySnapshot) => {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const transition = (phase: BoardConnectivityPhase, recovered = false) => {
    successes = 0;
    bootstrapComplete = false;
    clearTimeout(bannerTimer);
    publish({ phase, generation: snapshot.generation + 1, recoveredUntil: recovered ? now() + config.recoveredBannerMs : null });
    scheduleLoss();
    if (recovered && !stopped) {
      bannerTimer = setTimeout(() => {
        if (!stopped) publish({ ...snapshot, recoveredUntil: null });
      }, config.recoveredBannerMs);
    }
  };
  const checkElapsed = (lossTimerFired = false) => {
    if (!started || stopped) return;
    if ((snapshot.phase === 'online' || snapshot.phase === 'bootstrapping') && now() - lastSuccess >= config.lossAfterMs) {
      transition('offline');
    } else if (lossTimerFired) {
      // A timer can fire a fraction of a millisecond before the monotonic deadline; re-arm instead of waiting for the next probe.
      scheduleLoss();
    }
    if (snapshot.recoveredUntil !== null && now() >= snapshot.recoveredUntil) {
      clearTimeout(bannerTimer);
      publish({ ...snapshot, recoveredUntil: null });
    }
  };
  const scheduleLoss = () => {
    clearTimeout(lossTimer);
    if (!stopped && (snapshot.phase === 'online' || snapshot.phase === 'bootstrapping')) {
      lossTimer = setTimeout(() => checkElapsed(true), Math.max(1, Math.ceil(config.lossAfterMs - (now() - lastSuccess))));
    }
  };
  const recordSuccess = () => {
    lastSuccess = now();
    scheduleLoss();
  };
  const probeNow = () => {
    if (!started || stopped) return;
    checkElapsed();
    if (active || stopped) return;
    const controller = new AbortController();
    const generation = snapshot.generation;
    const finish = (success: boolean) => {
      if (stopped || active !== request) return;
      active = undefined;
      clearTimeout(request.timeout);
      checkElapsed();
      if (generation !== snapshot.generation) return;
      if (!success) {
        successes = 0;
        return;
      }
      recordSuccess();
      if (snapshot.phase === 'offline' || snapshot.phase === 'bootstrapping') {
        successes += 1;
        if (successes >= config.recoverySuccesses) {
          if (snapshot.phase === 'offline') transition('refreshing');
          else if (bootstrapComplete) transition('online');
        }
      }
    };
    const request = {
      controller,
      generation,
      deadline: now() + config.probeTimeoutMs,
      timeout: setTimeout(() => {
        finish(false);
        controller.abort();
      }, config.probeTimeoutMs)
    };
    active = request;
    // Catch synchronous throws as well as promise rejection; late settlement is ignored.
    void Promise.resolve().then(() => {
      if (stopped || active !== request) return false;
      return probe(controller.signal);
    }).then((success) => {
      const timely = now() < request.deadline;
      finish(success === true && timely);
      if (!timely) controller.abort();
    }, () => finish(false));
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (!stopped) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start() {
      if (started || stopped) return;
      started = true;
      lastSuccess = now();
      scheduleLoss();
      interval = setInterval(probeNow, config.probeIntervalMs);
      probeNow();
    },
    /** Both browser online and offline events only request an immediate probe. */
    probeNow,
    reportBoardReadSuccess(generation: number) {
      if (!started || stopped) return;
      checkElapsed();
      if (snapshot.phase === 'online' && generation === snapshot.generation) recordSuccess();
    },
    /** Call after publishing all required fresh data, with the generation it was requested in. */
    reportFullRefresh(generation: number, success: boolean) {
      if (!started || stopped) return;
      checkElapsed();
      if (generation !== snapshot.generation) return;
      if (snapshot.phase !== 'refreshing' && snapshot.phase !== 'bootstrapping') return;
      if (!success) {
        // At startup, a failed load is retried by the caller; only the 15s rule may declare offline.
        if (snapshot.phase === 'refreshing') transition('offline');
        return;
      }
      if (snapshot.phase === 'bootstrapping') {
        bootstrapComplete = true;
        if (successes < config.recoverySuccesses) return;
      }
      const recovered = snapshot.phase === 'refreshing';
      recordSuccess();
      transition('online', recovered);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      clearTimeout(lossTimer);
      clearTimeout(bannerTimer);
      if (active) {
        clearTimeout(active.timeout);
        active.controller.abort();
        active = undefined;
      }
      listeners.clear();
    }
  };
}
