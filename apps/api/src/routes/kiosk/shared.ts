import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { normalizeClientKey } from '../../lib/client-key.js';
import {
  resolveCredentialIdentity as resolveCredentialIdentityFromDevice,
  resolveDeviceName as resolveDeviceNameFromDevice,
  resolveDeviceScopeKey as resolveDeviceScopeKeyFromDevice,
  resolveInfraHost as resolveInfraHostFromDevice,
  resolveLocationScopeContext as resolveLocationScopeContextFromDevice,
  resolveSiteKey as resolveSiteKeyFromDevice,
  type ClientDeviceForScopeResolution,
  type CredentialIdentity,
  type LocationScopeContext
} from '../../lib/location-scope-resolver.js';
import { env } from '../../config/env.js';
import { getKioskRateLimitService } from '../../services/security/kiosk-rate-limit.service.js';

const MAC_LOCATION_ALIAS = 'Mac';

export { normalizeClientKey };

export const parseCsvList = (value: string | undefined): string[] => {
  if (!value) return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    )
  );
};

export const getWebRTCCallExcludeClientIds = (): Set<string> =>
  new Set(parseCsvList(process.env.WEBRTC_CALL_EXCLUDE_CLIENT_IDS));

export async function checkRateLimit(clientKey: string, ip: string): Promise<boolean> {
  const service = getKioskRateLimitService();
  return service.isAllowed({
    scope: 'kiosk-support',
    clientKey,
    ip,
    max: env.KIOSK_SUPPORT_RATE_LIMIT_MAX,
    windowMs: env.KIOSK_SUPPORT_RATE_LIMIT_WINDOW_MS,
  });
}

export async function checkPowerRateLimit(clientKey: string, ip: string): Promise<boolean> {
  const service = getKioskRateLimitService();
  return service.isAllowed({
    scope: 'kiosk-power',
    clientKey,
    ip,
    max: env.KIOSK_POWER_RATE_LIMIT_MAX,
    windowMs: env.KIOSK_POWER_RATE_LIMIT_WINDOW_MS,
  });
}

export async function requireClientDevice(rawClientKey: unknown): Promise<{
  clientKey: string;
  clientDevice: { id: string; apiKey: string; name: string; location: string | null; statusClientId: string | null };
}> {
  const clientKey = normalizeClientKey(rawClientKey);
  if (!clientKey) {
    throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
  }

  const clientDevice = await prisma.clientDevice.findUnique({
    where: { apiKey: clientKey }
  });
  if (!clientDevice) {
    throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
  }
  return { clientKey, clientDevice };
}

export type { ClientDeviceForScopeResolution, CredentialIdentity, LocationScopeContext };

export const resolveDeviceScopeKey = (
  clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>
): string => resolveDeviceScopeKeyFromDevice(clientDevice);

export const resolveSiteKey = (clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>): string =>
  resolveSiteKeyFromDevice(clientDevice);

export const resolveDeviceName = (clientDevice: Pick<ClientDeviceForScopeResolution, 'location' | 'name'>): string =>
  resolveDeviceNameFromDevice(clientDevice);

export const resolveInfraHost = (clientDevice: Pick<ClientDeviceForScopeResolution, 'name'>): string =>
  resolveInfraHostFromDevice(clientDevice);

export const resolveCredentialIdentity = (
  clientDevice: Pick<ClientDeviceForScopeResolution, 'id' | 'apiKey' | 'statusClientId'>
): CredentialIdentity => resolveCredentialIdentityFromDevice(clientDevice);

export const resolveLocationScopeContext = (clientDevice: ClientDeviceForScopeResolution): LocationScopeContext =>
  resolveLocationScopeContextFromDevice(clientDevice);

export const resolveTargetLocation = (params: {
  requestedTargetLocation?: string;
  actorLocation: string;
}): string => {
  const requested = params.requestedTargetLocation?.trim();
  if (requested) {
    return requested;
  }
  return params.actorLocation;
};

export const shouldRequireTargetLocationForActor = (actorLocation: string): boolean => {
  const requireForMac = process.env.KIOSK_DUE_MANAGEMENT_REQUIRE_TARGET_LOCATION_FOR_MAC === 'true';
  if (!requireForMac) {
    return false;
  }
  return actorLocation === MAC_LOCATION_ALIAS;
};
