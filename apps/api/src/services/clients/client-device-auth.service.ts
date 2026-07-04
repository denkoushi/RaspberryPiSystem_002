import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { normalizeClientKey } from '../../lib/client-key.js';

export async function findClientDeviceByApiKey(apiKey: string) {
  return prisma.clientDevice.findUnique({ where: { apiKey } });
}

export async function findClientDeviceStatusClientIdByApiKey(apiKey: string) {
  return prisma.clientDevice.findUnique({
    where: { apiKey },
    select: { statusClientId: true }
  });
}

export async function findClientDeviceIdRecordByApiKey(apiKey: string) {
  return prisma.clientDevice.findUnique({
    where: { apiKey },
    select: { id: true }
  });
}

export async function findClientDeviceProfileById(clientId: string) {
  return prisma.clientDevice.findUnique({
    where: { id: clientId },
    select: { id: true, name: true, location: true }
  });
}

/**
 * Parse x-client-key for measuring-instruments / part-measurement / loan-analytics allowClientKey.
 * Behavior matches the inline parsers in those route files (not identical to normalizeClientKey for arrays).
 */
export function parseKioskApiClientKeyHeader(rawClientKey: unknown): string | undefined {
  let clientKey: string | undefined;
  if (typeof rawClientKey === 'string') {
    try {
      const parsed = JSON.parse(rawClientKey);
      clientKey = typeof parsed === 'string' ? parsed : rawClientKey;
    } catch {
      clientKey = rawClientKey;
    }
  } else if (Array.isArray(rawClientKey) && rawClientKey.length > 0) {
    clientKey = rawClientKey[0];
  }
  return clientKey;
}

export async function assertKioskApiClientKeyValid(rawClientKey: unknown): Promise<void> {
  const clientKey = parseKioskApiClientKeyHeader(rawClientKey);
  if (!clientKey) {
    throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
  }

  const client = await findClientDeviceByApiKey(clientKey);
  if (!client) {
    throw new ApiError(403, 'クライアントキーが無効です', undefined, 'CLIENT_KEY_INVALID');
  }
}

export async function requireKioskClientDevice(rawClientKey: unknown): Promise<{
  clientKey: string;
  clientDevice: { id: string; apiKey: string; name: string; location: string | null; statusClientId: string | null };
}> {
  const clientKey = normalizeClientKey(rawClientKey);
  if (!clientKey) {
    throw new ApiError(401, 'クライアントキーが必要です', undefined, 'CLIENT_KEY_REQUIRED');
  }

  const clientDevice = await findClientDeviceByApiKey(clientKey);
  if (!clientDevice) {
    throw new ApiError(401, '無効なクライアントキーです', undefined, 'INVALID_CLIENT_KEY');
  }

  return { clientKey, clientDevice };
}

export async function resolveStatusClientIdFromRawKey(rawClientKey: unknown): Promise<string | null> {
  const clientKey = normalizeClientKey(rawClientKey);
  if (!clientKey) {
    return null;
  }

  const clientDevice = await findClientDeviceStatusClientIdByApiKey(clientKey);
  if (!clientDevice) {
    return null;
  }

  return clientDevice.statusClientId ?? null;
}
