import { lazy, type ComponentType } from 'react';

import { isKioskPath } from './kioskSeamlessUpdate';

export const KIOSK_PRELOAD_INITIAL_DELAY_MS = 5_000;
export const KIOSK_PRELOAD_GAP_MS = 1_000;
export type KioskPreloadScheduler = (callback: () => void, delayMs: number) => () => void;

export function createKioskLazyPreloader() {
  const loaders: Array<() => Promise<unknown>> = [];
  // Non-component resources (e.g. large help content) warm only after every route chunk.
  const backgroundLoaders: Array<() => Promise<unknown>> = [];
  let index = 0;
  let backgroundIndex = 0;
  let started = false;
  let active = false;
  let inFlight = false;
  let cancelScheduled: (() => void) | undefined;
  let schedule: KioskPreloadScheduler;

  const enqueue = (delayMs: number) => {
    if (!active || inFlight || (index >= loaders.length && backgroundIndex >= backgroundLoaders.length)) return;
    cancelScheduled = schedule(() => {
      cancelScheduled = undefined;
      if (!active) return;
      started = true;
      const loader = index < loaders.length ? loaders[index++] : backgroundLoaders[backgroundIndex++];
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

  const cached = <T>(loader: () => Promise<T>) => {
    let promise: Promise<T> | undefined;
    // Successful/in-flight imports are shared with the user-initiated load. A
    // speculative failure must not poison a later user-initiated load.
    return () => (promise ??= loader().catch((error: unknown) => { promise = undefined; throw error; }));
  };

  return {
    // Match React.lazy's component constraint while retaining each component's props.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lazy<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
      const load = cached(loader);
      loaders.push(load);
      return lazy(load);
    },
    /** Registers a non-component import, warmed after route chunks; returns its shared cached loader. */
    preload<T>(loader: () => Promise<T>): () => Promise<T> {
      const load = cached(loader);
      backgroundLoaders.push(load);
      return load;
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
export const kioskPreload = kioskPreloader.preload;
export const startKioskLazyPreload = kioskPreloader.start;
