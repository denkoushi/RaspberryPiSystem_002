import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { getKioskRateLimitService } from '../../services/security/kiosk-rate-limit.service.js';

const DEFAULT_LOCATION = 'default';

export const normalizeClientKey = (rawKey: unknown): string | undefined => {
  if (typeof rawKey === 'string') {
    try {
      const parsed = JSON.parse(rawKey);
      if (typeof parsed === 'string') {
        return parsed;
      }
    } catch {
      // noop
    }
    return rawKey;
  }
  if (Array.isArray(rawKey) && rawKey.length > 0 && typeof rawKey[0] === 'string') {
    return rawKey[0];
  }
  return undefined;
};

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
  clientDevice: { id: string; apiKey: string; name: string; location: string | null };
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

export const resolveLocationKey = (clientDevice: { location?: string | null; name: string }): string => {
  if (clientDevice.location && clientDevice.location.trim().length > 0) {
    return clientDevice.location.trim();
  }
  if (clientDevice.name && clientDevice.name.trim().length > 0) {
    return clientDevice.name.trim();
  }
  return DEFAULT_LOCATION;
};
