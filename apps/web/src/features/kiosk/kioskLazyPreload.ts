import { lazy, type ComponentType } from 'react';

import { isKioskPath } from './kioskSeamlessUpdate';

export const KIOSK_PRELOAD_INITIAL_DELAY_MS = 5_000;
export const KIOSK_PRELOAD_GAP_MS = 1_000;
export type KioskPreloadScheduler = (callback: () => void, delayMs: number) => () => void;

export function createKioskLazyPreloader() {
  const loaders: Array<() => Promise<unknown>> = [];
  let index = 0;
  let started = false;
  let active = false;
  let inFlight = false;
  let cancelScheduled: (() => void) | undefined;
  let schedule: KioskPreloadScheduler;

  const enqueue = (delayMs: number) => {
    if (!active || inFlight || index >= loaders.length) return;
    cancelScheduled = schedule(() => {
      cancelScheduled = undefined;
      if (!active) return;
      started = true;
      const loader = loaders[index++];
      inFlight = true;
      void (async () => {
        try { await loader(); } catch { /* Speculative loading must stay silent. */ }
        finally {
          inFlight = false;
          enqueue(KIOSK_PRELOAD_GAP_MS);
        }
      })();
    }, delayMs);
  };

  return {
    // Match React.lazy's component constraint while retaining each component's props.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lazy<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
      let promise: Promise<{ default: T }> | undefined;
      const load = () => {
        // Successful/in-flight imports are shared with React.lazy. A speculative
        // failure must not poison a later user-initiated lazy render.
        promise ??= loader().catch((error: unknown) => { promise = undefined; throw error; });
        return promise;
      };
      loaders.push(load);
      return lazy(load);
    },
    start(pathname: string, isDevelopment: boolean, scheduler: KioskPreloadScheduler): () => void {
      if (isDevelopment || !isKioskPath(pathname) || active) return () => {};
      active = true;
      schedule = scheduler;
      enqueue(started ? KIOSK_PRELOAD_GAP_MS : KIOSK_PRELOAD_INITIAL_DELAY_MS);
      return () => {
        active = false;
        cancelScheduled?.();
        cancelScheduled = undefined;
      };
    }
  };
}

const kioskPreloader = createKioskLazyPreloader();
export const kioskLazy = kioskPreloader.lazy;
export const startKioskLazyPreload = kioskPreloader.start;
