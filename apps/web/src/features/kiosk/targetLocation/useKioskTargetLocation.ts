import { useEffect, useState } from 'react';

import {
  DEFAULT_KIOSK_TARGET_LOCATIONS,
  KIOSK_TARGET_LOCATION_STORAGE_KEY,
  type KioskTargetLocation
} from './constants';

type Params = {
  storageKey?: string;
  targetLocations?: readonly string[];
  defaultTargetLocation?: string;
};

const normalizeTargetLocation = (value: string, targetLocations: readonly string[], fallback: string) => {
  const normalized = value.trim();
  if (!normalized) return fallback;
  return targetLocations.includes(normalized) ? normalized : fallback;
};

export const useKioskTargetLocation = (params?: Params) => {
  const storageKey = params?.storageKey ?? KIOSK_TARGET_LOCATION_STORAGE_KEY;
  const targetLocations = params?.targetLocations ?? DEFAULT_KIOSK_TARGET_LOCATIONS;
  const fallback = params?.defaultTargetLocation ?? targetLocations[0] ?? '';

  const [targetLocation, setTargetLocationState] = useState<string>(() => {
    if (typeof window === 'undefined') return fallback;
    const stored = window.localStorage.getItem(storageKey) ?? '';
    return normalizeTargetLocation(stored, targetLocations, fallback);
  });

  useEffect(() => {
    const normalized = normalizeTargetLocation(targetLocation, targetLocations, fallback);
    if (normalized !== targetLocation) {
      setTargetLocationState(normalized);
      return;
    }
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, normalized);
  }, [fallback, storageKey, targetLocation, targetLocations]);

  const setTargetLocation = (value: string) => {
    setTargetLocationState(normalizeTargetLocation(value, targetLocations, fallback));
  };

  return {
    targetLocation,
    targetLocations,
    setTargetLocation: setTargetLocation as (value: KioskTargetLocation | string) => void
  } as const;
};
