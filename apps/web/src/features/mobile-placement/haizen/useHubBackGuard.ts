import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';

const hubPath = '/kiosk/mobile-placement';
const sentinelKey = '__haizenHubSentinel';

/** One invisible duplicate of the hub, reused on browser Back and remounts. */
export function useHubBackGuard(enabled: boolean, closeOverlay: (() => void) | null) {
  const location = useLocation();
  const closeOverlayRef = useRef(closeOverlay);
  const armed = useRef(false);
  const sentinel = useRef({ state: window.history.state, url: window.location.href });

  useLayoutEffect(() => {
    closeOverlayRef.current = closeOverlay;
    if (!enabled || location.pathname !== hubPath || window.location.pathname !== hubPath) return;

    const state = { ...window.history.state, [sentinelKey]: true };
    if (!armed.current && !window.history.state?.[sentinelKey]) {
      // Keep BrowserRouter's usr/key/idx intact. This duplicate is invisible to
      // the router; the capture listener consumes only the corresponding POP.
      window.history.pushState(state, '', window.location.href);
    } else if (!window.history.state?.[sentinelKey]) {
      // A router REPLACE (e.g. consuming shelf return state) drops custom keys.
      window.history.replaceState(state, '', window.location.href);
    }
    armed.current = true;
    sentinel.current = { state, url: window.location.href };
  }, [enabled, location, closeOverlay]);

  useLayoutEffect(() => {
    if (!enabled || location.pathname !== hubPath) return;
    const onPopState = (event: PopStateEvent) => {
      if (window.location.pathname !== hubPath || event.state?.[sentinelKey]) return;
      // Run before BrowserRouter so its location/key and the hub's input state
      // never change. pushState replaces the popped forward sentinel.
      event.stopImmediatePropagation();
      window.history.pushState(sentinel.current.state, '', sentinel.current.url);
      closeOverlayRef.current?.();
    };
    window.addEventListener('popstate', onPopState, true);
    return () => window.removeEventListener('popstate', onPopState, true);
  }, [enabled, location.pathname]);
}
