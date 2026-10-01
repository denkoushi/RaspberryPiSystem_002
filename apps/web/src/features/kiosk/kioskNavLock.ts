import { useEffect, useSyncExternalStore } from 'react';

/**
 * A kiosk screen opened with the operation password (the tag desk) holds the navigation
 * while it is unlocked: the header with the other tabs cannot be revealed, so the person
 * leaves only through the screen's own lock button.
 */
let holders = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function change(delta: number) {
  holders += delta;
  listeners.forEach((listener) => listener());
}

/** True while any mounted screen holds the kiosk navigation. */
export function useKioskNavLocked(): boolean {
  return useSyncExternalStore(subscribe, () => holders > 0, () => false);
}

/** Holds the kiosk navigation for as long as the calling component is mounted. */
export function useHoldKioskNav(): void {
  useEffect(() => {
    change(1);
    return () => change(-1);
  }, []);
}
