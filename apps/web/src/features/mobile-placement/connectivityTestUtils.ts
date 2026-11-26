import { afterEach, beforeEach, vi } from 'vitest';

import { mobileRequest, resetMobileConnectivityForTests, type MobileConnection } from './connectivity';

/** Stubs navigator with a Network Information connection; returns a getter for the current stub. */
export function stubMobileConnection() {
  let connection: MobileConnection & { type?: string };
  beforeEach(() => {
    connection = new EventTarget();
    vi.stubGlobal('navigator', { onLine: true, connection });
  });
  afterEach(() => { resetMobileConnectivityForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  return () => connection;
}

/** A transport failure (no HTTP response), which marks the server unreachable. */
export const failMobileRequest = () => mobileRequest(() => Promise.reject(new Error('network'))).catch(() => {});
