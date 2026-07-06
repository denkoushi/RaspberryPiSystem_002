import {
  normalizeKioskInitialRoute,
  resolveKioskInitialPath,
  type KioskInitialRouteId,
  type KioskLegacyDefaultMode
} from '@raspi-system/shared-types';

export type KioskRedirectConfigSnapshot = {
  defaultMode?: KioskLegacyDefaultMode;
  initialKioskRoute?: string | null;
};

export type KioskInitialRedirectDecision = {
  targetPath: string | null;
  nextRouteSignature?: string;
  reason: 'outside-kiosk' | 'subpath' | 'loading' | 'error' | 'missing-config' | 'unchanged' | 'last-path' | 'initial-route';
};

function normalizeRedirectPathname(pathname: string): string {
  return pathname.replace(/\/$/, '');
}

function routeSignature(route: KioskInitialRouteId | null, defaultMode: unknown): string {
  if (route) return `route:${route}`;
  return `default:${defaultMode === 'PHOTO' ? 'PHOTO' : 'TAG'}`;
}

export function resolveKioskInitialRedirectDecision(input: {
  pathname: string;
  isLoading: boolean;
  hasError: boolean;
  config: KioskRedirectConfigSnapshot | null | undefined;
  lastKioskPath?: string | null;
  lastRouteSignature?: string;
}): KioskInitialRedirectDecision {
  const normalizedPath = normalizeRedirectPathname(input.pathname);
  const isOnRoot = normalizedPath === '';
  const isOnKioskRoot = normalizedPath === '/kiosk';
  const isOnKioskSubPath = normalizedPath.startsWith('/kiosk/');
  const isKioskEntryPath = isOnRoot || isOnKioskRoot || isOnKioskSubPath;

  if (!isKioskEntryPath) return { targetPath: null, reason: 'outside-kiosk' };
  if (isOnKioskSubPath) return { targetPath: null, reason: 'subpath' };
  if (input.isLoading) return { targetPath: null, reason: 'loading' };
  if (input.hasError) return { targetPath: '/kiosk/tag', reason: 'error' };
  if (!input.config) return { targetPath: '/kiosk/tag', reason: 'missing-config' };

  const hasInitialRouteValue =
    typeof input.config.initialKioskRoute === 'string' && input.config.initialKioskRoute.trim().length > 0;
  const initialRoute = normalizeKioskInitialRoute(input.config.initialKioskRoute);
  const nextRouteSignature = routeSignature(initialRoute, input.config.defaultMode);
  const shouldEvaluate =
    input.lastRouteSignature === undefined ||
    input.lastRouteSignature !== nextRouteSignature ||
    isOnKioskRoot ||
    isOnRoot;

  if (!shouldEvaluate) {
    return { targetPath: null, nextRouteSignature, reason: 'unchanged' };
  }

  if (isOnRoot && !hasInitialRouteValue && !initialRoute && input.lastKioskPath && input.lastKioskPath !== '/kiosk') {
    return { targetPath: input.lastKioskPath, nextRouteSignature, reason: 'last-path' };
  }

  const initialPath = resolveKioskInitialPath({
    initialRoute,
    defaultMode: input.config.defaultMode
  });

  return {
    targetPath: normalizeRedirectPathname(initialPath) === normalizedPath ? null : initialPath,
    nextRouteSignature,
    reason: 'initial-route'
  };
}
