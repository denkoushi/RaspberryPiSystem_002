import type { RateLimitOptions } from '@fastify/rate-limit';

/**
 * Ceiling for routes that kiosk terminals and other field devices call.
 *
 * The global plugin counts per registered terminal (or per IP without a key) and per route,
 * and this keeps that key. The value is far above normal use so field work never hits it:
 * on production the busiest terminal sent at most 41 requests per minute to one route.
 * An empty allowList keeps the limit even under prefixes the global plugin skips.
 */
export const TERMINAL_ROUTE_MAX_PER_MINUTE = 600;

export const TERMINAL_ROUTE_RATE_LIMIT: RateLimitOptions = Object.freeze({
  max: TERMINAL_ROUTE_MAX_PER_MINUTE,
  timeWindow: '1 minute',
  allowList: [],
});
