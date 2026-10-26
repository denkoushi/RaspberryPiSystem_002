import { readProductionBuildConfig } from '../../config/productionBuildConfig';

let registrationRequested = false;
let persistenceRequested = false;
const PERSIST_REQUESTED_KEY = 'mobile-app-shell-persist-requested';

export function isMobileAppShellPath(pathname: string): boolean {
  return pathname === '/kiosk/mobile-placement' ||
    pathname.startsWith('/kiosk/mobile-placement/') ||
    pathname === '/kiosk/purchase-order-lookup' || pathname === '/kiosk/purchase-order-lookup/';
}

export function isOfflineMobileAppShell(pathname: string): boolean {
  return isMobileAppShellPath(pathname) && (
    !navigator.onLine || document.querySelector('meta[name="mobile-app-shell-offline"]') !== null
  );
}

export function registerMobileAppShell(pathname: string): void {
  if (readProductionBuildConfig().isDevelopment) return;
  if (!isMobileAppShellPath(pathname) || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  if (!registrationRequested) {
    registrationRequested = true;
    try {
      void navigator.serviceWorker.register('/sw.js', { scope: '/kiosk/' }).catch(() => {});
    } catch { /* A failed registration must never block the app. */ }
  }
  if (persistenceRequested || !navigator.storage?.persist) return;
  persistenceRequested = true;
  try {
    if (localStorage.getItem(PERSIST_REQUESTED_KEY)) return;
    localStorage.setItem(PERSIST_REQUESTED_KEY, '1');
  } catch { /* Still request once per document when storage is unavailable. */ }
  try {
    void navigator.storage.persist().catch(() => {});
  } catch { /* Persistence is best effort. */ }
}
