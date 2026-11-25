import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import { normalizeClientKey } from './client-key.js';
import { createRateLimitDeviceCache } from '../plugins/rate-limit-device-cache.js';

/**
 * Ceiling for routes that kiosk terminals and other field devices call.
 *
 * Counts per registered terminal (or per IP without a key) and per route, like the global plugin.
 * The value is far above normal use so field work never hits it:
 * on production the busiest terminal sent at most 41 requests per minute to one route.
 * An empty allowList keeps the limit even under prefixes the global plugin skips.
 *
 * The device lookup uses its own cache so these many routes do not spend the per-source lookup
 * budget of the global plugin, which the other per-device limits (edge scans and the like) rely on.
 */
export const TERMINAL_ROUTE_MAX_PER_MINUTE = 600;

const lookupDevice = createRateLimitDeviceCache({
  // Loaded on first use so importing this module does not open a DB pool.
  lookup: async (apiKey) => (await import('./prisma.js')).prisma.clientDevice.findUnique({ where: { apiKey }, select: { id: true } })
});

const terminalRouteKey = async (request: FastifyRequest): Promise<string> => {
  const route = request.routeOptions.url ?? request.url;
  const apiKey = normalizeClientKey(request.headers['x-client-key']);
  const deviceId = apiKey ? await lookupDevice(apiKey, request.ip) : null;
  return deviceId ? `device:${deviceId}:${route}` : `${request.ip}:${route}`;
};

export const TERMINAL_ROUTE_RATE_LIMIT: RateLimitOptions = Object.freeze({
  max: TERMINAL_ROUTE_MAX_PER_MINUTE,
  timeWindow: '1 minute',
  allowList: [],
  keyGenerator: terminalRouteKey,
});
