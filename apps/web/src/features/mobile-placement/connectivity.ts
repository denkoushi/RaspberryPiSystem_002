import { isAxiosError } from 'axios';
import { useSyncExternalStore } from 'react';

import { api } from '../../api/http';

export const MOBILE_REQUEST_TIMEOUT_MS = 3000;
let unreachable = false;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function stopRecovery() {
  clearInterval(recoveryTimer);
  recoveryTimer = undefined;
}

function startRecovery() {
  if (recoveryTimer !== undefined) return;
  const timer = setInterval(async () => {
    if (!unreachable || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    try {
      await api.get('/kiosk/mobile-local-data/versions', {
        kioskTelemetry: 'background', timeout: MOBILE_REQUEST_TIMEOUT_MS, validateStatus: () => true
      });
      if (recoveryTimer === timer) reportMobileNetworkSuccess();
    } catch (error) {
      if (recoveryTimer === timer && isAxiosError(error) && error.response) reportMobileNetworkSuccess();
    }
  }, 15_000);
  recoveryTimer = timer;
}

export function canUseMobileNetwork() {
  return (typeof navigator === 'undefined' || navigator.onLine !== false) && !unreachable;
}

export function reportMobileNetworkSuccess() {
  if (!unreachable) return;
  unreachable = false;
  stopRecovery();
  notify();
}

export function resetMobileConnectivityForTests() {
  stopRecovery();
  unreachable = false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { unreachable = false; stopRecovery(); notify(); });
  window.addEventListener('offline', notify);
}

export function useMobileConnectivity() {
  return useSyncExternalStore(subscribe, canUseMobileNetwork, () => true);
}

/** Bound each mobile request locally; never change the shared QueryClient's onlineManager. */
export async function mobileRequest<T>(request: () => Promise<T>, { timeoutMs = MOBILE_REQUEST_TIMEOUT_MS } = {}): Promise<T> {
  if (!canUseMobileNetwork()) throw new Error('Mobile network unavailable offline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // A late response still proves reachability, but cannot overwrite the caller's fallback.
    const response = Promise.resolve().then(request).then((value) => {
      reportMobileNetworkSuccess();
      return value;
    }, (error: unknown) => {
      if (isAxiosError(error) && error.response) reportMobileNetworkSuccess();
      throw error;
    });
    return await Promise.race([
      response,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mobile request timed out')), timeoutMs);
      })
    ]);
  } catch (error) {
    // HTTP errors reached the server; preserve existing needs-check and retry behavior.
    if (!(isAxiosError(error) && error.response)) {
      unreachable = true;
      startRecovery();
      notify();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
