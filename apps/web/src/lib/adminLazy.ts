import { lazy, type ComponentType } from 'react';

import { isKnownDynamicImportFailure } from '../features/kiosk/kioskRuntimeRecovery';

export const ADMIN_CHUNK_RELOAD_STORAGE_KEY = 'raspi:admin-chunk-reload:v1';
export const ADMIN_CHUNK_RELOAD_WINDOW_MS = 60_000;

export interface AdminChunkReloadRuntime {
  now(): number;
  readStored(): string | null;
  writeStored(value: string): void;
  reload(): void;
}

const browserRuntime: AdminChunkReloadRuntime = {
  now: () => Date.now(),
  readStored: () => window.sessionStorage.getItem(ADMIN_CHUNK_RELOAD_STORAGE_KEY),
  writeStored: (value) => window.sessionStorage.setItem(ADMIN_CHUNK_RELOAD_STORAGE_KEY, value),
  reload: () => window.location.reload()
};

function claimReload(runtime: AdminChunkReloadRuntime): boolean {
  try {
    const now = runtime.now();
    const last = Number(runtime.readStored());
    if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < ADMIN_CHUNK_RELOAD_WINDOW_MS) {
      return false;
    }
    runtime.writeStored(String(now));
    return true;
  } catch {
    return false;
  }
}

/**
 * React.lazy for admin routes. An admin tab kept open across a Web deployment
 * still holds the old entry, whose hashed chunks no longer exist; reload once so
 * the tab picks up the current build instead of failing into the error screen.
 */
// Match React.lazy's component constraint while retaining each component's props.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function adminLazy<T extends ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
  runtime: AdminChunkReloadRuntime = browserRuntime
) {
  return lazy(() =>
    loader().catch((error: unknown) => {
      if (!isKnownDynamicImportFailure(error) || !claimReload(runtime)) throw error;
      runtime.reload();
      return new Promise<never>(() => {});
    })
  );
}
