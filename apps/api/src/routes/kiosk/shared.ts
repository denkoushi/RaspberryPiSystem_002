import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';

const DEFAULT_LOCATION = 'default';

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1分
const RATE_LIMIT_MAX_REQUESTS = 3;
const powerRateLimitMap = new Map<string, number[]>();
const POWER_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1分
const POWER_RATE_LIMIT_MAX_REQUESTS = 1;

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

export function checkRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const requests = rateLimitMap.get(clientKey) || [];

  // 古いリクエストを削除
  const recentRequests = requests.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false; // レート制限超過
  }

  recentRequests.push(now);
  rateLimitMap.set(clientKey, recentRequests);

  // メモリリーク防止: 5分以上古いエントリを削除
  if (rateLimitMap.size > 100) {
    for (const [key, timestamps] of rateLimitMap.entries()) {
      const filtered = timestamps.filter((ts) => now - ts < 5 * 60 * 1000);
      if (filtered.length === 0) {
        rateLimitMap.delete(key);
      } else {
        rateLimitMap.set(key, filtered);
      }
    }
  }

  return true;
}

export function checkPowerRateLimit(clientKey: string): boolean {
  const now = Date.now();
  const requests = powerRateLimitMap.get(clientKey) || [];
  const recentRequests = requests.filter((timestamp) => now - timestamp < POWER_RATE_LIMIT_WINDOW_MS);

  if (recentRequests.length >= POWER_RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  recentRequests.push(now);
  powerRateLimitMap.set(clientKey, recentRequests);

  if (powerRateLimitMap.size > 100) {
    for (const [key, timestamps] of powerRateLimitMap.entries()) {
      const filtered = timestamps.filter((ts) => now - ts < 5 * 60 * 1000);
      if (filtered.length === 0) {
        powerRateLimitMap.delete(key);
      } else {
        powerRateLimitMap.set(key, filtered);
      }
    }
  }

  return true;
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
