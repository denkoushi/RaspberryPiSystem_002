import type { FastifyRequest } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { normalizeClientKey } from '../../lib/client-key.js';

export type ErrorLogDevice = { clientDeviceId: string; clientDeviceName: string; statusClientId: string | null };
const cache = new Map<string, { expires: number; value: Promise<ErrorLogDevice | undefined> }>();
const TTL_MS = 30000;
const TIMEOUT_MS = 200;

// Run in the logging path only: responses never await this lookup.
export function resolveErrorLogDevice(request: FastifyRequest): Promise<ErrorLogDevice | undefined> {
  const resolved = (request as FastifyRequest & { clientDevice?: { id: string; name: string; statusClientId?: string | null } }).clientDevice;
  if (resolved) return Promise.resolve({ clientDeviceId: resolved.id, clientDeviceName: resolved.name, statusClientId: resolved.statusClientId ?? null });
  const key = normalizeClientKey(request.headers['x-client-key']);
  if (!key) return Promise.resolve(undefined);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.value;
  for (const [entryKey, entry] of cache) if (entry.expires <= now) cache.delete(entryKey);
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  const value = new Promise<ErrorLogDevice | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), TIMEOUT_MS);
    void Promise.resolve().then(() => prisma.clientDevice.findUnique({
      where: { apiKey: key }, select: { id: true, name: true, statusClientId: true }
    })).then((device) => {
      clearTimeout(timer);
      resolve(device ? { clientDeviceId: device.id, clientDeviceName: device.name, statusClientId: device.statusClientId } : undefined);
    }, () => { clearTimeout(timer); resolve(undefined); });
  });
  cache.set(key, { expires: now + TTL_MS, value });
  return value;
}
