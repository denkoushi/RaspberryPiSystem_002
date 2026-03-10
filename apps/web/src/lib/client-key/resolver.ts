import { CLIENT_KEY_CONFIG } from './config';
import { getClientKeyFromStorage, getClientKeyFromUrl, setClientKeyToStorage } from './sources';

import type { ResolveOptions, ResolveResult } from './types';

type EnvironmentKind = 'mac' | 'linuxArm' | 'other';

const isKioskPath = (pathname: string): boolean => pathname.startsWith('/kiosk');

const detectEnvironment = (userAgent: string): EnvironmentKind => {
  const isMac = /Macintosh|Mac OS X/i.test(userAgent);
  const isChromeOS = /CrOS/i.test(userAgent);
  const isLinuxArm = /Linux/i.test(userAgent) && /(arm|aarch64)/i.test(userAgent) && !isChromeOS;

  if (isMac) return 'mac';
  if (isLinuxArm) return 'linuxArm';
  return 'other';
};

const getRecommendedDefaultClientKey = (userAgent: string, pathname: string): string => {
  const env = detectEnvironment(userAgent);
  if (env === 'mac') return CLIENT_KEY_CONFIG.defaultsByEnvironment.mac;
  if (isKioskPath(pathname)) return CLIENT_KEY_CONFIG.defaultsByEnvironment.linuxArm;
  return env === 'linuxArm'
    ? CLIENT_KEY_CONFIG.defaultsByEnvironment.linuxArm
    : CLIENT_KEY_CONFIG.defaultsByEnvironment.demo;
};

const normalizeProvidedKey = (provided?: string): string | null => {
  if (!provided) return null;
  const trimmed = provided.trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith(CLIENT_KEY_CONFIG.keyPrefix) ? trimmed : null;
};

const applyCrossDeviceCorrection = (resolvedKey: string, userAgent: string, pathname: string): string => {
  const env = detectEnvironment(userAgent);
  const isPi4Key = resolvedKey === CLIENT_KEY_CONFIG.pi4Key;

  if (env === 'other' && !isKioskPath(pathname) && isPi4Key) {
    const nextKey = CLIENT_KEY_CONFIG.defaultsByEnvironment.demo;
    setClientKeyToStorage(nextKey);
    return nextKey;
  }

  return resolvedKey;
};

export const isMacEnvironment = (userAgent: string): boolean => detectEnvironment(userAgent) === 'mac';

export function resolveClientKey(options?: ResolveOptions): ResolveResult {
  const providedKey = normalizeProvidedKey(options?.providedKey);
  if (providedKey) {
    return { key: providedKey, source: 'props' };
  }

  if (typeof window === 'undefined') {
    return { key: CLIENT_KEY_CONFIG.defaultsByEnvironment.linuxArm, source: 'default' };
  }

  const urlKey = getClientKeyFromUrl();
  if (urlKey) {
    setClientKeyToStorage(urlKey);
    return { key: urlKey, source: 'url' };
  }

  const storedKey = getClientKeyFromStorage();
  if (storedKey) {
    const corrected = applyCrossDeviceCorrection(storedKey, navigator.userAgent, window.location.pathname);
    return { key: corrected, source: 'storage' };
  }

  if (options?.allowDefaultFallback === false) {
    return { key: '', source: 'default' };
  }

  const defaultKey = getRecommendedDefaultClientKey(navigator.userAgent, window.location.pathname);
  return { key: defaultKey, source: 'default' };
}

export function ensureClientKeyStorageInitialized(): void {
  if (typeof window === 'undefined') return;

  const existing = getClientKeyFromStorage();
  if (!existing) {
    const defaultKey = getRecommendedDefaultClientKey(navigator.userAgent, window.location.pathname);
    setClientKeyToStorage(defaultKey);
    return;
  }

  const corrected = applyCrossDeviceCorrection(existing, navigator.userAgent, window.location.pathname);
  setClientKeyToStorage(corrected);
}
