import { readProductionBuildConfig } from '../../config/productionBuildConfig';

import {
  decideKioskWebUpdate,
  isKioskPath,
  KIOSK_WEB_UPDATE_POLL_MS,
  KIOSK_WEB_UPDATE_STORAGE_KEY
} from './kioskSeamlessUpdate';

import type { KioskPreloadScheduler } from './kioskLazyPreload';

export const scheduleKioskPreload: KioskPreloadScheduler = (callback, delayMs) => {
  let idleId: number | undefined;
  let fallbackId: number | undefined;
  const timerId = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(callback);
    } else {
      fallbackId = window.setTimeout(callback, 0);
    }
  }, delayMs);
  return () => {
    window.clearTimeout(timerId);
    if (idleId !== undefined) window.cancelIdleCallback(idleId);
    if (fallbackId !== undefined) window.clearTimeout(fallbackId);
  };
};

export function readKioskDocumentEntry(doc: Document, origin: string): string | null {
  if (!doc.querySelector('#root')) return null;
  const scripts = doc.querySelectorAll('script[type="module"][src]');
  if (scripts.length !== 1) return null;
  try {
    const url = new URL(scripts[0].getAttribute('src')!, origin);
    return url.origin === origin && /^\/assets\/[^/]+\.js$/.test(url.pathname) ? url.href : null;
  } catch {
    return null;
  }
}

export function extractKioskEntryScript(html: string, contentType: string | null, origin: string): string | null {
  if (contentType?.split(';')[0].trim().toLowerCase() !== 'text/html' || !/<html[\s>]/i.test(html)) return null;
  return readKioskDocumentEntry(new DOMParser().parseFromString(html, 'text/html'), origin);
}

export const kioskIdleWebNavigation = {
  replace(href: string) { window.location.replace(href); }
};

/** Existing deploy-status remains the maintenance authority. Unknown = blocked. */
export function startBrowserKioskWebUpdate(isMaintenance: () => boolean): () => void {
  if (readProductionBuildConfig().isDevelopment || !isKioskPath(window.location.pathname)) return () => {};
  const origin = window.location.origin;
  const currentEntry = readKioskDocumentEntry(document, origin);
  if (!currentEntry) return () => {};
  let lastInputAtMs = Date.now();
  let stopped = false;
  let inFlight = false;
  let controller: AbortController | undefined;
  const onInput = () => { lastInputAtMs = Date.now(); };
  const events = ['pointerdown', 'pointermove', 'pointerup', 'keydown', 'keyup', 'touchstart', 'touchmove', 'touchend', 'wheel'] as const;
  for (const event of events) window.addEventListener(event, onInput, { capture: true, passive: true });

  const poll = async () => {
    if (stopped || inFlight || isMaintenance() || !navigator.onLine || !isKioskPath(window.location.pathname)) return;
    inFlight = true;
    controller = new AbortController();
    const requestPath = window.location.pathname;
    const timeout = window.setTimeout(() => controller?.abort(), 10_000);
    try {
      const response = await fetch(requestPath, { cache: 'no-store', signal: controller.signal });
      if (!response.ok || response.redirected) return;
      const serverEntry = extractKioskEntryScript(await response.text(), response.headers.get('content-type'), origin);
      if (stopped || window.location.pathname !== requestPath) return;
      const focused = document.activeElement;
      const decision = decideKioskWebUpdate({
        pathname: window.location.pathname,
        currentEntry,
        serverEntry,
        nowMs: Date.now(),
        lastInputAtMs,
        hasInputFocus: Boolean(focused?.matches('input, textarea, select')
          || (focused instanceof HTMLElement && focused.isContentEditable)),
        hasDialog: Boolean(document.querySelector('[role="dialog"], dialog[open]')),
        hasChatPanel: Boolean(document.querySelector('.hermes-chat-panel, .operation-guide-card')),
        isOnline: navigator.onLine === true,
        isMaintenance: isMaintenance(),
        storedValue: window.sessionStorage.getItem(KIOSK_WEB_UPDATE_STORAGE_KEY)
      });
      if (decision.kind !== 'reload') return;
      window.sessionStorage.setItem(KIOSK_WEB_UPDATE_STORAGE_KEY, decision.storedValue);
      stopped = true;
      kioskIdleWebNavigation.replace(window.location.href);
    } catch { /* Network, parsing and storage failures never trigger navigation or telemetry. */ }
    finally {
      window.clearTimeout(timeout);
      inFlight = false;
    }
  };
  const timer = window.setInterval(() => void poll(), KIOSK_WEB_UPDATE_POLL_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    controller?.abort();
    for (const event of events) window.removeEventListener(event, onInput, true);
  };
}
