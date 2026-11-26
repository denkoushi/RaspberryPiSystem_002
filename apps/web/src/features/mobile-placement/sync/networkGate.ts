import { useSyncExternalStore } from 'react';

import { canUseMobileNetwork, isMobileServerUnreachable, isOnWifiOrEthernet, subscribeMobileConnectivity } from '../connectivity';

type Connection = EventTarget & { type?: string };
const connection = () => typeof navigator === 'undefined' ? undefined
  : (navigator as Navigator & { connection?: Connection }).connection;

// Sync only when the phone is confirmed to be on Wi-Fi (or wired); never on mobile data or an unknown link.
export function canSyncNow() {
  return canUseMobileNetwork() && isOnWifiOrEthernet();
}

export function subscribeCanSync(listener: () => void) {
  const current = connection();
  current?.addEventListener('change', listener);
  const unsubscribe = subscribeMobileConnectivity(listener);
  return () => {
    current?.removeEventListener('change', listener);
    unsubscribe();
  };
}

export function useCanSync() {
  return useSyncExternalStore(subscribeCanSync, canSyncNow, () => false);
}

// Wi-Fi is up but the server cannot be reached (usually Tailscale is off).
export function isServerUnreachableOnWifi() {
  if (typeof navigator === 'undefined' || navigator.onLine === false) return false;
  return isMobileServerUnreachable() && isOnWifiOrEthernet();
}

export function useServerUnreachableOnWifi() {
  return useSyncExternalStore(subscribeCanSync, isServerUnreachableOnWifi, () => false);
}
