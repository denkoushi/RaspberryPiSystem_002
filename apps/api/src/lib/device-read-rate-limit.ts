import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import { normalizeClientKey } from './client-key.js';

export const DEVICE_READ_MAX_PER_MINUTE = 12_000;
export const DEVICE_READ_IP_MAX_PER_MINUTE = 96_000;

export function createDeviceReadRateLimit({ queryKey = false } = {}): RateLimitOptions {
  const clientKey = (request: FastifyRequest): string | undefined => {
    if (queryKey && typeof request.query === 'object' && request.query !== null && 'key' in request.query) {
      const key = String(request.query.key);
      if (key) return key;
    }
    return normalizeClientKey(request.headers['x-client-key']);
  };

  return {
    max: (request) => clientKey(request) ? DEVICE_READ_MAX_PER_MINUTE : DEVICE_READ_IP_MAX_PER_MINUTE,
    timeWindow: '1 minute',
    // Route options override the global allowList inherited by the plugin.
    allowList: [],
    keyGenerator: (request) => {
      const key = clientKey(request);
      return JSON.stringify([request.routeOptions.url, key ? 'client' : 'ip', key || request.ip]);
    },
  };
}
